// C14 OperatorCommand (operator via /operator → bus `operator.command`). Owner: crowd (builds /operator).
// Handlers: world = round.*, replay.start, mode.set, haunt.dareDone · crowd = haunt.* (except dareDone),
// finals.approvalMode · brain = policy.pin, coach.run.
import { z } from "zod";
import { Driver, Id, Ms, WorldMode } from "./common.js";
import { Episode } from "./episode.js";

export const VERSION = "1.0.0";

const cmd = <C extends string, S extends z.ZodRawShape>(name: C, shape: S) =>
  z.object({ cmd: z.literal(name), ...shape }).strict();

export const OperatorCommand = z.discriminatedUnion("cmd", [
  cmd("round.start", {
    seed: Episode.shape.seed,
    task: Episode.shape.task,
    driver: Driver.optional(),
    maxDurationMs: Ms.max(90000).optional(),
    round: z.number().int().nonnegative().optional(),
  }),
  cmd("round.stop", { episodeId: Id }),
  cmd("replay.start", { sourceEpisodeId: Id }),
  cmd("mode.set", { mode: WorldMode }),
  cmd("haunt.approve", { hauntId: Id }),
  cmd("haunt.reject", { hauntId: Id }),
  cmd("haunt.releaseSeeded", { count: z.number().int().min(1).max(12) }),
  cmd("haunt.dareDone", { hauntId: Id }), // webcam mode
  cmd("finals.approvalMode", { on: z.boolean() }),
  cmd("policy.pin", { version: z.string().min(1) }),
  cmd("coach.run", {}),
]);
export type OperatorCommand = z.infer<typeof OperatorCommand>;
