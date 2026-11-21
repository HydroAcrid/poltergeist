// C05 TickResponse, Perception, Action (brain → world). Owner: brain.
import { z } from "zod";
import { Box, Id, Key, Ms, Point } from "./common.js";

export const VERSION = "1.1.0"; // 1.1.0: optional `decision`

export const Hazard = z.object({
  label: z.string().min(1).max(30),
  point: Point.optional(),
});
export type Hazard = z.infer<typeof Hazard>;

export const Perception = z
  .object({
    visible: z.boolean(),
    point: Point.optional(), // required iff visible
    box: Box.optional(),
    conf: z.number().min(0).max(1),
    hazards: z.array(Hazard).max(5),
    model: z.string().min(1),
    latencyMs: Ms,
    error: z.enum(["timeout", "parse", "api"]).optional(),
  })
  .refine((p) => p.visible === (p.point !== undefined), {
    message: "point is required iff visible",
    path: ["point"],
  });
export type Perception = z.infer<typeof Perception>;

export const Action = z
  .object({
    key: Key,
    holdMs: Ms.max(1500),
  })
  .refine((a) => a.key !== "NOOP" || a.holdMs === 0, {
    message: "NOOP must have holdMs 0",
    path: ["holdMs"],
  });
export type Action = z.infer<typeof Action>;

export const TickMode = z.enum(["track", "search", "unstick", "success", "fallback"]);
export type TickMode = z.infer<typeof TickMode>;

/** The motor actions the player chooses between; each maps to one Key hold. */
export const Intent = z.enum(["walk", "step_left", "step_right", "turn_left", "turn_right", "hold", "back_up"]);
export type Intent = z.infer<typeof Intent>;

/**
 * How this tick's action was chosen (1.1.0). `model`: the player model chose it
 * from the frames. `veto`: the model chose `intent`, but geometry found a solid
 * obstacle that way, so `action` differs. `geometry`: fixed rules decided
 * (mid-stumble, arrival, exit not in view).
 */
export const Decision = z.object({
  source: z.enum(["model", "veto", "geometry"]),
  intent: Intent,
  target: Point.optional(), // floor point the chosen move heads for, in this frame
  observed: z.string().max(80).optional(), // what visibly changed, in the model's own words
});
export type Decision = z.infer<typeof Decision>;

export const TickResponse = z.object({
  episodeId: Id,
  seq: z.number().int().nonnegative(),
  t: Ms,
  perception: Perception,
  action: Action, // world ignores it when driver = "human"
  mode: TickMode,
  rationale: z.string().max(60),
  successClaim: z.boolean(),
  policyVersion: z.string().min(1),
  brainLatencyMs: Ms,
  decision: Decision.optional(),
});
export type TickResponse = z.infer<typeof TickResponse>;
