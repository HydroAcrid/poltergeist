// C06 TickLog (brain → bus `tick`). Owner: brain.
import { z } from "zod";
import { Driver, Id, Ms } from "./common.js";
import { Action, Decision, Perception, TickMode } from "./tick-response.js";

export const VERSION = "1.2.0"; // 1.1.0: optional `reaction` · 1.2.0: optional `decision`

/**
 * What Brain observed the robot do on this tick, set only on the tick it was
 * observed. `unclear` flags a reaction Brain cannot tell apart (for example a
 * stall while pushing forward); consumers should not score it.
 */
export const Reaction = z.enum(["avoid", "stumble", "recover", "unclear"]);
export type Reaction = z.infer<typeof Reaction>;

export const TickLog = z.object({
  episodeId: Id,
  seq: z.number().int().nonnegative(),
  t: Ms,
  driver: Driver,
  framePath: z.string().min(1), // data/episodes/<id>/frames/<seq>.jpg (written by brain)
  frameDiff: z.number().min(0).max(1),
  perception: Perception,
  action: Action,
  mode: TickMode,
  rationale: z.string().max(60),
  successClaim: z.boolean(),
  policyVersion: z.string().min(1),
  reaction: Reaction.optional(),
  decision: Decision.optional(), // same as the TickResponse's; framePath is the supporting frame
});
export type TickLog = z.infer<typeof TickLog>;
