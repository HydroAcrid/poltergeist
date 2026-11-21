// C12 ReplayFrame, ReplayEvalRequest, ReplayEvalResult. Owner: brain.
import { z } from "zod";
import { EpochMs, HauntTag, Id, Ms, Point } from "./common.js";
import { ByTag } from "./policy.js";

export const VERSION = "1.0.0";

export const ReplaySplit = z.enum(["train", "heldout"]);
export const EvalSplit = z.enum(["train", "heldout", "clean"]);

export const ReplayFrame = z.object({
  frameId: Id,
  episodeId: Id,
  seq: z.number().int().nonnegative(),
  t: Ms,
  path: z.string().min(1),
  label: z
    .object({ visible: z.boolean(), point: Point.optional() })
    .refine((l) => l.visible === (l.point !== undefined), {
      message: "point is required iff visible",
      path: ["point"],
    }),
  labelSource: z.enum(["audit_model", "human"]),
  tags: z.array(HauntTag), // tags of hauntings injected in the 10 s before t
  split: ReplaySplit, // split BY EPISODE (never by frame)
  clean: z.boolean(), // no haunting in the previous 10 s
});
export type ReplayFrame = z.infer<typeof ReplayFrame>;

export const ReplayEvalRequest = z.object({
  policyVersion: z.string().min(1).optional(),
  policyYaml: z.string().min(1).optional(),
  split: EvalSplit,
  limit: z.number().int().positive().optional(),
});
export type ReplayEvalRequest = z.infer<typeof ReplayEvalRequest>;

export const ReplayEvalResult = z.object({
  policyVersion: z.string().min(1),
  split: EvalSplit,
  n: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
  meanPointErr: z.number().nonnegative().optional(),
  byTag: ByTag,
  latencyP50: Ms,
  latencyP95: Ms,
  ranAt: EpochMs,
});
export type ReplayEvalResult = z.infer<typeof ReplayEvalResult>;

/** A hit: visible matches, and if visible, point within 80 units (Euclidean, 0–1000 space). */
export const HIT_RADIUS = 80;
