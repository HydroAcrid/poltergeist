import type { Box, Point } from "@poltergeist/contracts/common.js";
import type { Intent, Perception } from "@poltergeist/contracts/tick-response.js";
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
  /** The frame Brain itself received on the previous tick (pixels only), so the model can see what changed. */
  previousFrame?: TickRequest["frame"];
}

/** The player model's own choice for this tick (decision mode "model"). */
export interface ModelDecision {
  intent: Intent;
  target?: Point;
  /** What visibly changed since the previous frame, in the model's words ("nothing" if nothing). */
  observed: string;
  /** Why, ≤ 60 chars. */
  reason: string;
  /** True when the move responds to something in or near the way. */
  avoiding: boolean;
  /** How many robots matching the player's description are visible (>1: can't tell which is the player). */
  robotCount?: number;
  /** The planned follow-up move if nothing changes (lets the next tick act if its look is late). */
  then?: Intent;
}

/** A target-shaped thing the perceiver saw. It never says which one is real. */
export interface Candidate {
  point: Point;
  box?: Box;
  conf: number;
  depth: "recessed" | "flat" | "unclear";
}

/**
 * Third-person view: where the avatar's feet are, what lies on the floor and
 * where the exit threshold is. All points are what the perceiver saw in this
 * frame; nothing here says whether the round is won.
 */
export interface Scene {
  feet: { left: Point; right: Point };
  /** True when the boots were out of frame and `feet` is the camera rig's estimated ground anchor. */
  feetEstimated?: boolean;
  /** The player's visible body box, when the perceiver reports it (used to tell if the shot is too wide). */
  robotBox?: Box;
  /** `solid: false` = the perceiver judged it walkable (flat, soft, harmless); geometry ignores it. */
  obstacles: { point: Point; box?: Box; solid?: boolean }[];
  goal?: Point;
  /** Floor point about two strides straight ahead of the boots (the robot's facing). */
  forward?: Point;
  pose: "upright" | "stumbling";
}

/** Contract `Perception`, plus brain-internal candidates or a third-person scene. */
export type PerceptionResult = Perception & { candidates?: Candidate[]; scene?: Scene; decision?: ModelDecision };

export interface PerceiveOptions {
  timeoutMs: number;
  promptAddenda: string[];
  /** Ask the model to choose the move too (policy decision mode "model"). */
  decide?: boolean;
  /** The move Brain applied last tick, so the model can keep a plan (not audience data). */
  previousMove?: Intent;
  /** Model thinking effort from the policy; "low" means no thinking budget. */
  thinking?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface PerceptionAdapter {
  readonly name: "er2" | "hydrogen" | "neon" | "fixture";
  perceive(input: PlayerInput, opts: PerceiveOptions): Promise<PerceptionResult>;
}
