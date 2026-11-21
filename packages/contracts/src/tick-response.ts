// C05 TickResponse, Perception, Action (brain → world). Owner: brain.
import { z } from "zod";
import { Box, Id, Key, Ms, Point } from "./common.js";

export const VERSION = "1.0.0";

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
});
export type TickResponse = z.infer<typeof TickResponse>;
