// TEMPORARY stand-in for World's packages/contracts/src/haunt-injected.ts (C08),
// transcribed from CONTRACTS.md. Delete once World's file is on main.
import { z } from "zod";
import { Id, Ms } from "./common.js";

export const VERSION = "1.0.0";

export const HauntInjected = z.object({
  hauntId: Id,
  episodeId: Id,
  t: Ms,
  ok: z.boolean(),
  simulated: z.boolean(),
  error: z.string().optional(),
});
export type HauntInjected = z.infer<typeof HauntInjected>;
