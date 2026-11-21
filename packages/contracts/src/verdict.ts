// C09 Verdict (crowd → bus `verdict.provisional` / `verdict.final`). Owner: crowd.
import { z } from "zod";
import { Blame, EpochMs, Id, Ms } from "./common.js";

export const VERSION = "1.1.0";

export const HallwayResult = z.object({
  reason: z.enum(["exit", "time", "fear", "interrupted"]),
  reactions: z.array(z.object({
    hauntId: Id, at: EpochMs, kind: z.enum(["scare", "sidestep"]),
  }).strict()),
}).strict();
export type HallwayResult = z.infer<typeof HallwayResult>;

export const Verdict = z
  .object({
    episodeId: Id,
    hallway: HallwayResult.optional(),
    stage: z.enum(["provisional", "final"]),
    outcome: z.enum(["success", "failure", "aborted"]),
    failureT: Ms.optional(), // required iff outcome = failure
    blame: Blame.optional(), // required iff outcome = failure
    culpritHauntId: Id.optional(), // required iff blame = adversary
    ruleBlame: Blame.optional(), // what the deterministic rule said
    overrodeRule: z.boolean(),
    evidence: z.array(z.object({ t: Ms, note: z.string().min(1).max(80) }).strict()).max(5),
    confidence: z.number().min(0).max(1),
    model: z.string().min(1).optional(), // "rule" or the model id
    createdAt: EpochMs,
  })
  .strict()
  .superRefine((v, ctx) => {
    const failure = v.outcome === "failure";
    if (failure !== (v.failureT !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["failureT"], message: "failureT is required iff outcome = failure" });
    }
    if (failure !== (v.blame !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["blame"], message: "blame is required iff outcome = failure" });
    }
    if ((v.blame === "adversary") !== (v.culpritHauntId !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["culpritHauntId"], message: "culpritHauntId is required iff blame = adversary" });
    }
    if (v.culpritHauntId !== undefined && !v.culpritHauntId.startsWith("ht_")) {
      ctx.addIssue({ code: "custom", path: ["culpritHauntId"], message: "culpritHauntId must be a haunt id (ht_…)" });
    }
  });
export type Verdict = z.infer<typeof Verdict>;
