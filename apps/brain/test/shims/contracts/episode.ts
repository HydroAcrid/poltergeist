// TEMPORARY stand-in for World's packages/contracts/src/episode.ts (C03),
// transcribed from CONTRACTS.md. Delete once World's file is on main.
import { z } from "zod";
import { Driver, EpochMs, Id, Ms } from "./common.js";

export const VERSION = "1.0.0";

export const WorldMode = z.enum(["genie", "webcam", "replay"]);

export const Episode = z.object({
  episodeId: Id,
  sessionId: Id.nullable(),
  mode: WorldMode,
  driver: Driver,
  replayOf: Id.optional(),
  seed: z.object({ kind: z.enum(["text", "image", "both"]), prompt: z.string().max(400), imagePath: z.string().optional() }),
  task: z.object({ targetLabel: z.string().max(40), instruction: z.string().max(140) }),
  policyVersion: z.string().min(1),
  round: z.number().int().optional(),
  startedAt: EpochMs,
  maxDurationMs: Ms.max(90_000),
});
export type Episode = z.infer<typeof Episode>;

export const EpisodeEnded = z.object({
  episodeId: Id,
  endedAt: EpochMs,
  durationMs: Ms,
  reason: z.enum(["success_claim", "timeout", "operator_stop", "error", "watchdog"]),
  error: z.string().optional(),
  genieClosedCleanly: z.boolean().nullable(),
  artifacts: z.object({ eventsPath: z.string(), framesDir: z.string(), videoPath: z.string().optional() }),
});
export type EpisodeEnded = z.infer<typeof EpisodeEnded>;
