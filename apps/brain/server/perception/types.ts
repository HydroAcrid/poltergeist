import type { Box, Point } from "@poltergeist/contracts/common.js";
import type { Perception } from "@poltergeist/contracts/tick-response.js";
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";

/**
 * Everything the player is allowed to see on a tick: the camera frame and the
 * operator's task. Nothing about the round's setup (the world seed prompt, the
 * ghost's haunting text) or which object is the real target may be added here.
 */
export interface PlayerInput {
  frame: TickRequest["frame"];
  targetLabel: string;
  instruction: string;
}

/** A target-shaped thing the perceiver saw. It never says which one is real. */
export interface Candidate {
  point: Point;
  box?: Box;
  conf: number;
  depth: "recessed" | "flat" | "unclear";
}

/** Contract `Perception`, plus brain-internal candidates when the adapter reports several. */
export type PerceptionResult = Perception & { candidates?: Candidate[] };

export interface PerceiveOptions {
  timeoutMs: number;
  promptAddenda: string[];
  signal?: AbortSignal;
}

export interface PerceptionAdapter {
  readonly name: "er2" | "hydrogen" | "neon" | "fixture";
  perceive(input: PlayerInput, opts: PerceiveOptions): Promise<PerceptionResult>;
}
