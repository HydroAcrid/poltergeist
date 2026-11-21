// `er2` PerceptionAdapter: Gemini Robotics-ER 2 (model from PG_MODEL_PERCEPTION).
// Third-person scene perception: ER 2 reports what it sees (boots, facing,
// obstacles, exit threshold, pose); Brain's controller decides the move.
// The request carries only the frame plus the task (PlayerInput).
import type { Box, Point } from "@poltergeist/contracts/common.js";
import type { ModelDecision, PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput, Scene } from "./types.js";

export const DEFAULT_MODEL = "gemini-robotics-er-2-preview";

/**
 * Thinking tokens count toward maxOutputTokens. Measured on the live probe:
 * default thinking spent ~765 tokens and truncated the JSON at an 800 cap;
 * a 0 budget finished in ~1.8 s. The output cap always leaves room for the JSON.
 */
export const THINKING_BUDGET = { low: 0, medium: 512, high: 2048 } as const;
const JSON_TOKENS = 1200;

/** The player's own body, from apps/world/robot-v1 (not audience or answer data). */
export const ROBOT_DESCRIPTION =
  "a knee-high robot with a scuffed sage-green shell, a burnt-orange backpack with two dark straps, thin jointed legs, cream-soled boots and a short black flashlight in its right hand";

export function buildScenePrompt(input: PlayerInput, promptAddenda: string[] = []): string {
  return [
    `This is a third-person game frame. The player is ${ROBOT_DESCRIPTION}. A camera trails behind and to the robot's right.`,
    `Goal: ${input.targetLabel}. Task: ${input.instruction}`,
    "Report only what is visible in this image. Coordinates are integers [y, x] normalized to 0-1000, origin top-left; boxes are [ymin, xmin, ymax, xmax].",
    "robotVisible: whether the robot is in frame. feet: the points where its left and right boots touch the floor; omit feet if the boots are outside the frame.",
    "forward: a floor point about two robot strides straight ahead of its boots, in the direction its body faces.",
    "obstacles: up to 5 solid objects on the floor near the robot's route (furniture, objects, people). Box each one down to where it touches the floor and give a short label.",
    "exit: whether the exit doorway is visible, and the floor point at the middle of its threshold, beneath the exit sign.",
    "pose: 'stumbling' only if the robot is visibly slipping, tipping or falling; otherwise 'upright'.",
    ...promptAddenda,
  ].join("\n");
}

const pointSchema = { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 };
export const SCENE_SCHEMA = {
  type: "object",
  properties: {
    robotVisible: { type: "boolean" },
    feet: { type: "object", properties: { left: pointSchema, right: pointSchema }, required: ["left", "right"] },
    forward: pointSchema,
    obstacles: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: { label: { type: "string" }, box: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 } },
        required: ["label", "box"],
      },
    },
    exit: { type: "object", properties: { visible: { type: "boolean" }, point: pointSchema }, required: ["visible"] },
    pose: { type: "string", enum: ["upright", "stumbling"] },
  },
  required: ["robotVisible", "obstacles", "exit", "pose"],
} as const;

export const INTENTS = ["walk", "step_left", "step_right", "turn_left", "turn_right", "hold", "back_up"] as const;

/**
 * Decision mode: the same perception plus the player's own choice. The wording
 * is deliberately general (no object names, no per-event rules) and identical
 * for every frame; only the images change. The audience's text never appears.
 */
export function buildDecisionPrompt(input: PlayerInput, promptAddenda: string[] = []): string {
  return [
    `You are the player in a third-person game: ${ROBOT_DESCRIPTION}. The camera follows close behind the robot.`,
    `Goal: ${input.targetLabel}. Task: ${input.instruction}`,
    input.previousFrame
      ? "The first image is the previous frame, about half a second ago; the second image is the current frame. Compare them."
      : "The image is the current frame; there is no earlier frame yet.",
    "Report what is visible in the CURRENT frame. Coordinates are integers [y, x] normalized to 0-1000, origin top-left; boxes are [ymin, xmin, ymax, xmax].",
    "robotVisible: whether the robot is in frame. robotCount: how many separate robot bodies of any kind are visible, counting each robot once even if it looks different from the player. feet: where its boots touch the floor; omit if the boots are outside the frame.",
    "obstacles: up to 5 things on or above the floor near the robot's route. Box each one down to where it meets the floor, give a short label, and set solid: true if the robot could not walk through or over it, false if it is flat, soft or would not stop a step.",
    "exit: whether the exit doorway is visible, and the floor point at the middle of its threshold.",
    "pose: 'stumbling' if the robot is visibly slipping, tipping, falling or thrown off balance; otherwise 'upright'.",
    "change: in a few words, what visibly changed near the robot or its route since the previous frame; 'nothing' if nothing did.",
    `Then choose the robot's next move from what actually happened in the images. intent: one of ${INTENTS.join(", ")}.`,
    "If more than one robot body is visible, you cannot be sure which one you control: hold. Keep heading for the exit while the way is passable. Step around something solid in the next few steps. Something flat or harmless may be walked over. Something moving nearby but not in the way need not stop the robot. If the robot is off balance, hold. Turn only to bring the exit or a clear way into view. Back up only if something solid is right against it.",
    "target: the floor point [y, x] the move heads for. reason: why, at most 60 characters. avoiding: true only if the move responds to something in or near the way.",
    ...promptAddenda,
  ].join("\n");
}

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    ...SCENE_SCHEMA.properties,
    obstacles: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          box: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
          solid: { type: "boolean" },
        },
        required: ["label", "box", "solid"],
      },
    },
    robotCount: { type: "integer" },
    change: { type: "string" },
    intent: { type: "string", enum: [...INTENTS] },
    target: pointSchema,
    reason: { type: "string" },
    avoiding: { type: "boolean" },
  },
  required: ["robotVisible", "robotCount", "obstacles", "exit", "pose", "change", "intent", "reason", "avoiding"],
} as const;

/** The decision part of a decision-mode reply, or undefined if missing or invalid. */
export function parseDecision(text: string): ModelDecision | undefined {
  const raw = JSON.parse(stripFences(text)) as Record<string, any>;
  if (!INTENTS.includes(raw.intent)) return undefined;
  const target = toPoint(raw.target);
  return {
    intent: raw.intent,
    ...(target ? { target } : {}),
    observed: String(raw.change ?? "nothing").slice(0, 80) || "nothing",
    reason: String(raw.reason ?? "").slice(0, 60) || raw.intent,
    avoiding: raw.avoiding === true,
    ...(Number.isInteger(raw.robotCount) && raw.robotCount >= 0 ? { robotCount: raw.robotCount } : {}),
  };
}

/** Anything with the slice of @google/genai we use; tests pass a fake. */
export interface GenAiLike {
  models: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the SDK's wide parameter type
    generateContent(req: any): Promise<{ text?: string | undefined }>;
  };
}

const clampCoord = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1000, Math.max(0, Math.round(v))) : undefined;

export function toPoint(v: unknown): Point | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [y, x] = v.map(clampCoord);
  return y === undefined || x === undefined ? undefined : [y, x];
}

export function toBox(v: unknown): Box | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const c = v.map(clampCoord);
  if (c.some((n) => n === undefined)) return undefined;
  const [a, b, cc, d] = c as number[];
  const box: Box = [Math.min(a!, cc!), Math.min(b!, d!), Math.max(a!, cc!), Math.max(b!, d!)];
  return box[0] < box[2] && box[1] < box[3] ? box : undefined;
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export interface ParsedScene {
  robotVisible: boolean;
  scene?: Scene;
  exit?: Point;
  obstacleLabels: string[];
}

/** Parse ER 2's reply defensively: strip fences, clamp to range, drop invalid parts. Throws on non-JSON. */
export function parseScene(text: string, anchor?: Point): ParsedScene {
  const raw = JSON.parse(stripFences(text)) as Record<string, any>;
  const left = toPoint(raw.feet?.left);
  const right = toPoint(raw.feet?.right);
  const exit = raw.exit?.visible === true ? toPoint(raw.exit?.point) : undefined;
  const obstacles = (Array.isArray(raw.obstacles) ? raw.obstacles : [])
    .map((o: any) => ({
      label: String(o?.label ?? "obstacle").slice(0, 30) || "obstacle",
      box: toBox(o?.box),
      ...(typeof o?.solid === "boolean" ? { solid: o.solid } : {}),
    }))
    .filter((o: { box?: Box }) => o.box)
    .slice(0, 5) as { label: string; box: Box; solid?: boolean }[];
  // Shoulder rig (anchor given): the boots are below the frame by design, so always
  // use the rig's estimated ground anchor. ER 2 still returns boot points for
  // hidden boots (live probe on synthetic POV frames, 8/8), which are guesses.
  const estimated = raw.robotVisible === true && anchor !== undefined;
  const feetL = estimated ? ([anchor![0], Math.max(0, anchor![1] - 15)] as Point) : left;
  const feetR = estimated ? ([anchor![0], Math.min(1000, anchor![1] + 15)] as Point) : right;
  const robotVisible = raw.robotVisible === true && !!feetL && !!feetR;
  const forward = toPoint(raw.forward);
  return {
    robotVisible,
    exit,
    obstacleLabels: obstacles.map((o) => o.label),
    ...(robotVisible
      ? {
          scene: {
            feet: { left: feetL!, right: feetR! },
            ...(estimated ? { feetEstimated: true } : {}),
            obstacles: obstacles.map((o) => ({
              point: [Math.round((o.box[0] + o.box[2]) / 2), Math.round((o.box[1] + o.box[3]) / 2)] as Point,
              box: o.box,
              ...(o.solid !== undefined ? { solid: o.solid } : {}),
            })),
            ...(exit ? { goal: exit } : {}),
            ...(forward ? { forward } : {}),
            pose: raw.pose === "stumbling" ? ("stumbling" as const) : ("upright" as const),
          },
        }
      : {}),
  };
}

export class Er2Perception implements PerceptionAdapter {
  readonly name = "er2" as const;
  /** The last raw reply text, for the live probe's report. Never contains the key. */
  lastRaw = "";
  /** The last API error message, for diagnosis (the SDK does not echo the key). */
  lastError = "";

  constructor(
    private readonly client: GenAiLike,
    private readonly model = DEFAULT_MODEL,
    private readonly now: () => number = () => performance.now(),
    /** Camera rig ground anchor used when the boots are out of frame (shoulder rig). */
    private readonly anchor?: Point,
  ) {}

  async perceive(input: PlayerInput, opts: PerceiveOptions): Promise<PerceptionResult> {
    const started = this.now();
    const decide = opts.decide === true;
    const prompt = decide ? buildDecisionPrompt(input, opts.promptAddenda) : buildScenePrompt(input, opts.promptAddenda);
    const image = (f: PlayerInput["frame"]) => ({ inlineData: { mimeType: f.mime, data: f.b64 } });
    const images = decide && input.previousFrame ? [image(input.previousFrame), image(input.frame)] : [image(input.frame)];
    const fail = (error: "timeout" | "parse" | "api"): PerceptionResult => ({
      visible: false, conf: 0, hazards: [], model: this.model, latencyMs: Math.round(this.now() - started), error,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = opts.timeoutMs - (this.now() - started);
      if (attempt > 0 && remaining < 800) break;
      // The budget is enforced here by aborting, never as httpOptions.timeout:
      // that becomes a server deadline, and Gemini rejects any under 10 s (400).
      const budget = AbortSignal.timeout(Math.max(1, Math.round(remaining)));
      const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
      let text: string;
      try {
        const res = await this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [...images, { text: prompt }] }],
          config: {
            temperature: 0,
            maxOutputTokens: THINKING_BUDGET[opts.thinking ?? "low"] + JSON_TOKENS,
            thinkingConfig: { thinkingBudget: THINKING_BUDGET[opts.thinking ?? "low"] },
            responseMimeType: "application/json",
            responseJsonSchema: decide ? DECISION_SCHEMA : SCENE_SCHEMA,
            abortSignal: signal,
          },
        });
        text = res.text ?? "";
      } catch (error) {
        this.lastError = String((error as Error)?.message ?? error).slice(0, 300);
        return fail(signal.aborted ? "timeout" : "api");
      }
      this.lastRaw = text;
      let parsed: ParsedScene;
      let decision: ModelDecision | undefined;
      try {
        parsed = parseScene(text, this.anchor);
        if (decide) decision = parseDecision(text);
      } catch {
        continue; // parse failure: retry once if budget allows
      }
      const latencyMs = Math.round(this.now() - started);
      if (parsed.scene) {
        const hazards = parsed.scene.obstacles.map((o, i) => ({ label: parsed.obstacleLabels[i] ?? "obstacle", point: o.point }));
        return {
          visible: parsed.exit !== undefined,
          ...(parsed.exit ? { point: parsed.exit } : {}),
          conf: parsed.exit ? 0.8 : 0.3,
          hazards,
          model: this.model,
          latencyMs,
          scene: parsed.scene,
          ...(decision ? { decision } : {}),
        };
      }
      // Robot not found: report the exit (if any) as a plain target; the
      // first-person controller will search or track it.
      return {
        visible: parsed.exit !== undefined,
        ...(parsed.exit ? { point: parsed.exit } : {}),
        conf: parsed.exit ? 0.5 : 0.1,
        hazards: [],
        model: this.model,
        latencyMs,
      };
    }
    return fail("parse");
  }
}
