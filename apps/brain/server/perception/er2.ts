// `er2` PerceptionAdapter: Gemini Robotics-ER 2 (model from PG_MODEL_PERCEPTION).
// Third-person scene perception: ER 2 reports what it sees (boots, facing,
// obstacles, exit threshold, pose); Brain's controller decides the move.
// The request carries only the frame plus the task (PlayerInput).
import type { Box, Point } from "@poltergeist/contracts/common.js";
import type { PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput, Scene } from "./types.js";

export const DEFAULT_MODEL = "gemini-robotics-er-2-preview";

/** The player's own body, from apps/world/robot-v1 (not audience or answer data). */
export const ROBOT_DESCRIPTION =
  "a knee-high robot with a scuffed sage-green shell, a burnt-orange backpack with two dark straps, thin jointed legs, cream-soled boots and a short black flashlight in its right hand";

export function buildScenePrompt(input: PlayerInput, promptAddenda: string[] = []): string {
  return [
    `This is a third-person game frame. The player is ${ROBOT_DESCRIPTION}. A camera trails behind and to the robot's right.`,
    `Goal: ${input.targetLabel}. Task: ${input.instruction}`,
    "Report only what is visible in this image. Coordinates are integers [y, x] normalized to 0-1000, origin top-left; boxes are [ymin, xmin, ymax, xmax].",
    "robotVisible: whether the robot is in frame. feet: the points where its left and right boots touch the floor.",
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
export function parseScene(text: string): ParsedScene {
  const raw = JSON.parse(stripFences(text)) as Record<string, any>;
  const left = toPoint(raw.feet?.left);
  const right = toPoint(raw.feet?.right);
  const exit = raw.exit?.visible === true ? toPoint(raw.exit?.point) : undefined;
  const obstacles = (Array.isArray(raw.obstacles) ? raw.obstacles : [])
    .map((o: any) => ({ label: String(o?.label ?? "obstacle").slice(0, 30) || "obstacle", box: toBox(o?.box) }))
    .filter((o: { box?: Box }) => o.box)
    .slice(0, 5) as { label: string; box: Box }[];
  const robotVisible = raw.robotVisible === true && !!left && !!right;
  const forward = toPoint(raw.forward);
  return {
    robotVisible,
    exit,
    obstacleLabels: obstacles.map((o) => o.label),
    ...(robotVisible
      ? {
          scene: {
            feet: { left: left!, right: right! },
            obstacles: obstacles.map((o) => ({ point: [Math.round((o.box[0] + o.box[2]) / 2), Math.round((o.box[1] + o.box[3]) / 2)] as Point, box: o.box })),
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

  constructor(
    private readonly client: GenAiLike,
    private readonly model = DEFAULT_MODEL,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async perceive(input: PlayerInput, opts: PerceiveOptions): Promise<PerceptionResult> {
    const started = this.now();
    const prompt = buildScenePrompt(input, opts.promptAddenda);
    const fail = (error: "timeout" | "parse" | "api"): PerceptionResult => ({
      visible: false, conf: 0, hazards: [], model: this.model, latencyMs: Math.round(this.now() - started), error,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = opts.timeoutMs - (this.now() - started);
      if (attempt > 0 && remaining < 800) break;
      let text: string;
      try {
        const res = await this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: input.frame.mime, data: input.frame.b64 } }, { text: prompt }] }],
          config: {
            temperature: 0,
            maxOutputTokens: 800,
            responseMimeType: "application/json",
            responseJsonSchema: SCENE_SCHEMA,
            httpOptions: { timeout: Math.max(1, Math.round(remaining)) },
            ...(opts.signal ? { abortSignal: opts.signal } : {}),
          },
        });
        text = res.text ?? "";
      } catch (error) {
        const msg = String((error as Error)?.message ?? error);
        return fail(/timeout|abort|deadline/i.test(msg) ? "timeout" : "api");
      }
      this.lastRaw = text;
      let parsed: ParsedScene;
      try {
        parsed = parseScene(text);
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
