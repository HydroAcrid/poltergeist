// C11 PolicyPromoted, EvalSummary (brain → crowd). Owner: brain.
import { z } from "zod";
import { EpochMs, HauntTag } from "./common.js";

export const VERSION = "1.0.0";

const Rate = z.number().min(0).max(1);
const Count = z.number().int().nonnegative();

// Partial<Record<HauntTag, …>>: zod 3 treats an enum-keyed record as partial
// and rejects keys outside the enum.
export const ByTag = z.record(HauntTag, z.object({ n: Count, hitRate: Rate }));
export type ByTag = z.infer<typeof ByTag>;

export const EvalSummary = z.object({
  n: Count,
  hitRate: Rate,
  byTag: ByTag,
});
export type EvalSummary = z.infer<typeof EvalSummary>;

export const PolicyPromoted = z.object({
  version: z.string().min(1),
  parent: z.string().min(1),
  createdBy: z.enum(["human", "coach"]),
  rationale: z.string().max(140),
  eval: z.object({
    heldout: EvalSummary,
    clean: EvalSummary,
    parentHeldout: EvalSummary,
    parentClean: EvalSummary,
  }),
  promotedAt: EpochMs,
});
export type PolicyPromoted = z.infer<typeof PolicyPromoted>;
