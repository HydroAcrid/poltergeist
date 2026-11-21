// TEMPORARY stand-in for World's packages/contracts/src/tick-request.ts (C04),
// transcribed from CONTRACTS.md. Delete once World's file is on main.
import { z } from "zod";
import { Driver, HauntTag, Id, Key, Ms } from "@poltergeist/contracts/common.js";

export const VERSION = "1.0.0";

export const TickRequest = z.object({
  episodeId: Id,
  seq: z.number().int().nonnegative(),
  t: Ms,
  driver: Driver,
  frame: z.object({
    mime: z.literal("image/jpeg"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    b64: z.string().min(1).max(80_000),
  }),
  frameDiff: z.number().min(0).max(1),
  executing: z.object({ key: Key, holdMs: Ms, startedT: Ms }).optional(),
  recentHaunts: z.array(z.object({ hauntId: Id, t: Ms, tags: z.array(HauntTag) })),
});
export type TickRequest = z.infer<typeof TickRequest>;
