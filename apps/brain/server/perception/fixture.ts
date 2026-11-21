// `fixture` PerceptionAdapter: answers from fixtures/media/fixture-zero without
// calling any model. Frames are matched by the SHA-256 of their JPEG bytes, so
// the only thing it learns from the player is the frame itself.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Box, Point } from "@poltergeist/contracts/common.js";
import type { PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput, Scene } from "./types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const FIXTURE_ZERO = resolve(repoRoot, "fixtures/media/fixture-zero");
/** World-owned third-person frames (read-only for Brain). */
export const WORLD_HALLWAY = resolve(repoRoot, "apps/world/painted-door/haunting/fixtures");
/** World-owned frames from a live flashlight round (read-only for Brain). */
export const WORLD_FLASHLIGHT = resolve(repoRoot, "apps/world/robot-v1/fixtures");

/** World's hallway labels (scoring data). Brain reads them; it never edits them. */
export const HallwayLabels = z.object({
  frames: z.array(
    z.object({
      file: z.string(),
      feet: z.object({ left: Point, right: Point }),
      hazard: z.object({ point: Point, box: Box.optional() }).passthrough().nullable(),
      goal: Point,
      stumbling: z.boolean(),
      arrived: z.boolean(),
    }).passthrough(),
  ),
});
export type HallwayLabels = z.infer<typeof HallwayLabels>;

export function loadHallwayLabels(dir = WORLD_HALLWAY): HallwayLabels {
  return HallwayLabels.parse(JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")));
}

const Label = z.object({
  file: z.string(),
  visible: z.boolean(),
  point: Point.optional(),
  box: Box.optional(),
  decoys: z.array(z.object({ point: Point, box: Box.optional() })).optional(),
});
export type Label = z.infer<typeof Label>;

const Observation = z.object({
  file: z.string(),
  hypothesis: z.string().optional(),
  candidates: z.array(
    z.object({ point: Point, box: Box.optional(), conf: z.number().min(0).max(1), depth: z.enum(["recessed", "flat", "unclear"]) }),
  ),
});
type Observation = z.infer<typeof Observation>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Ground-truth labels for scorers. The adapter itself only uses them for frames with no observation. */
export function loadLabels(dir = FIXTURE_ZERO): Label[] {
  return z.array(Label).parse(JSON.parse(readFileSync(join(dir, "labels.json"), "utf8")));
}

export class FixturePerception implements PerceptionAdapter {
  readonly name = "fixture" as const;
  private readonly observations = new Map<string, Observation>();
  private readonly labels = new Map<string, Label>();
  private readonly scenes = new Map<string, Scene>();
  /** Which file answered the last call; for tests that the decoy frames never read ground truth. */
  lastSource: "observation" | "label" | "scene" | "none" = "none";

  constructor(dir = FIXTURE_ZERO, sceneDirs: string[] = [WORLD_HALLWAY, WORLD_FLASHLIGHT]) {
    const observations = z.array(Observation).parse(JSON.parse(readFileSync(join(dir, "observations.json"), "utf8")));
    for (const o of observations) this.observations.set(sha256(readFileSync(join(dir, o.file))), o);
    for (const l of loadLabels(dir)) this.labels.set(sha256(readFileSync(join(dir, l.file))), l);

    // Third-person frames: report only what is visible (feet, obstacle, threshold,
    // pose). World's `arrived` flag, written observations and the prototype's
    // lane/depth are scoring data and are deliberately not passed on.
    for (const sceneDir of sceneDirs) {
      if (!existsSync(join(sceneDir, "labels.json"))) continue;
      for (const f of loadHallwayLabels(sceneDir).frames) {
        this.scenes.set(sha256(readFileSync(join(sceneDir, f.file))), {
          feet: { left: f.feet.left, right: f.feet.right },
          obstacles: f.hazard ? [{ point: f.hazard.point, ...(f.hazard.box ? { box: f.hazard.box } : {}) }] : [],
          goal: f.goal,
          pose: f.stumbling ? "stumbling" : "upright",
        });
      }
    }
  }

  async perceive(input: PlayerInput, _opts: PerceiveOptions): Promise<PerceptionResult> {
    const started = performance.now();
    const key = sha256(Buffer.from(input.frame.b64, "base64"));
    const latencyMs = () => Math.round(performance.now() - started);
    const base = { hazards: [], model: "fixture" };

    const scene = this.scenes.get(key);
    if (scene) {
      this.lastSource = "scene";
      return {
        ...base,
        visible: scene.goal !== undefined,
        ...(scene.goal ? { point: scene.goal } : {}),
        conf: 1,
        hazards: scene.obstacles.slice(0, 5).map((o) => ({ label: "obstacle", point: o.point })),
        latencyMs: latencyMs(),
        scene,
      };
    }

    const obs = this.observations.get(key);
    if (obs) {
      this.lastSource = "observation";
      const top = [...obs.candidates].sort((a, b) => b.conf - a.conf)[0];
      return {
        ...base,
        visible: obs.candidates.length > 0,
        ...(top ? { point: top.point, box: top.box } : {}),
        conf: top?.conf ?? 0,
        latencyMs: latencyMs(),
        candidates: obs.candidates,
      };
    }
    const label = this.labels.get(key);
    if (label) {
      this.lastSource = "label";
      return label.visible
        ? { ...base, visible: true, point: label.point, box: label.box, conf: 1, latencyMs: latencyMs() }
        : { ...base, visible: false, conf: 1, latencyMs: latencyMs() };
    }
    this.lastSource = "none";
    return { ...base, visible: false, conf: 0, latencyMs: latencyMs(), error: "api" };
  }
}
