// `fixture` PerceptionAdapter: answers from fixtures/media/fixture-zero without
// calling any model. Frames are matched by the SHA-256 of their JPEG bytes, so
// the only thing it learns from the player is the frame itself.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Box, Point } from "@poltergeist/contracts/common.js";
import type { PerceiveOptions, PerceptionAdapter, PerceptionResult, PlayerInput } from "./types.js";

export const FIXTURE_ZERO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/media/fixture-zero");

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
  /** Which file answered the last call; for tests that the decoy frames never read ground truth. */
  lastSource: "observation" | "label" | "none" = "none";

  constructor(dir = FIXTURE_ZERO) {
    const observations = z.array(Observation).parse(JSON.parse(readFileSync(join(dir, "observations.json"), "utf8")));
    for (const o of observations) this.observations.set(sha256(readFileSync(join(dir, o.file))), o);
    for (const l of loadLabels(dir)) this.labels.set(sha256(readFileSync(join(dir, l.file))), l);
  }

  async perceive(input: PlayerInput, _opts: PerceiveOptions): Promise<PerceptionResult> {
    const started = performance.now();
    const key = sha256(Buffer.from(input.frame.b64, "base64"));
    const latencyMs = () => Math.round(performance.now() - started);
    const base = { hazards: [], model: "fixture" };

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
