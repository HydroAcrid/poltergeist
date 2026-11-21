// C03. One public episode can span multiple provider sessions.
import { z } from "zod";
import { HallwayResult } from "@poltergeist/contracts/verdict.js";
import { Driver, EpochMs, Id, Ms, WorldMode } from "./common.js";

export const VERSION = "1.1.0";
export { WorldMode };
export const maxProviderDurationMs = 90_000;
export const Match = z.discriminatedUnion("clockMode", [
  z.object({ clockMode: z.literal("wall"), durationMs: Ms.positive(), deadline: EpochMs }),
  z.object({ clockMode: z.literal("active"), durationMs: Ms.positive() }),
]);

export const Episode = z.object({
  episodeId: Id,
  sessionId: Id.nullable(),
  mode: WorldMode,
  driver: Driver,
  replayOf: Id.optional(),
  seed: z.object({
    kind: z.enum(["text", "image", "both"]),
    prompt: z.string().max(400),
    imagePath: z.string().optional(),
  }),
  task: z.object({ targetLabel: z.string().max(40), instruction: z.string().max(140) }),
  policyVersion: z.string().min(1),
  round: z.number().int().nonnegative().optional(),
  startedAt: EpochMs,
  maxDurationMs: Ms.max(maxProviderDurationMs),
  match: Match.optional(),
});
export type Episode = z.infer<typeof Episode>;

export const EpisodeEnded = z.object({
  episodeId: Id,
  endedAt: EpochMs,
  hallway: HallwayResult.optional(),
  durationMs: Ms,
  reason: z.enum(["success_claim", "timeout", "operator_stop", "error", "watchdog"]),
  error: z.string().optional(),
  genieClosedCleanly: z.boolean().nullable(),
  artifacts: z.object({ eventsPath: z.string(), framesDir: z.string(), videoPath: z.string().optional() }),
});
export type EpisodeEnded = z.infer<typeof EpisodeEnded>;
