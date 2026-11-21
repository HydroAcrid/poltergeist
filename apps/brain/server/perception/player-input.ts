import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { PlayerInput } from "./types.js";

/** The only part of an Episode the player may read: C03 `Episode.task`. */
export interface PlayerTask {
  targetLabel: string; // ≤ 40 chars
  instruction: string; // ≤ 140 chars
}

/**
 * Build the player's input from a tick and the episode task, copying only the
 * allowed fields. Takes the task on its own (never the whole Episode) so the
 * seed prompt and haunting text cannot ride along.
 */
export function buildPlayerInput(req: TickRequest, task: PlayerTask, previousFrame?: TickRequest["frame"]): PlayerInput {
  if (task.targetLabel.length > 40) throw new Error("targetLabel over 40 chars");
  if (task.instruction.length > 140) throw new Error("instruction over 140 chars");
  const copy = (f: TickRequest["frame"]) => ({ mime: f.mime, width: f.width, height: f.height, b64: f.b64 });
  return {
    frame: copy(req.frame),
    targetLabel: task.targetLabel,
    instruction: task.instruction,
    ...(previousFrame ? { previousFrame: copy(previousFrame) } : {}),
  };
}
