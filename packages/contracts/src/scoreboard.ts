// C10 Scoreboard (crowd → bus `scoreboard.updated`, HTTP `GET /api/crowd/scoreboard`). Owner: crowd.
import { z } from "zod";
import { EpochMs, HauntTag } from "./common.js";

export const VERSION = "1.1.0";

const Count = z.number().int().nonnegative();

export const Scoreboard = z
  .object({
    updatedAt: EpochMs,
    rounds: Count,
    episodes: Count,
    successes: Count,
    hallwayWins: z.object({ robot: Count, audience: Count }).strict().optional(),
    attacks: z.object({ submitted: Count, approved: Count, injected: Count, landed: Count }).strict(),
    uniqueAttackers: Count,
    topAttackers: z.array(z.object({ displayName: z.string().min(1).max(16), landed: Count }).strict()).max(5),
    topTags: z.array(z.object({ tag: HauntTag, injected: Count, landed: Count }).strict()),
    blame: z.object({ adversary: Count, agent: Count, world: Count }).strict(),
    policy: z.object({ version: z.string().min(1), heldoutHitRate: z.number().min(0).max(1).optional() }).strict(),
    killFeed: z.array(z.object({ ts: EpochMs, text: z.string().min(1).max(90) }).strict()).max(8), // display-safe
  })
  .strict();
export type Scoreboard = z.infer<typeof Scoreboard>;
