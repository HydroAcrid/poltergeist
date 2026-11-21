// C06 TickLog (brain → bus `tick`). Owner: brain.
import { z } from "zod";
import { Driver, Id, Ms } from "./common.js";
import { Action, Perception, TickMode } from "./tick-response.js";

export const VERSION = "1.0.0";

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
});
export type TickLog = z.infer<typeof TickLog>;
