// Third-person navigation: the avatar's feet are in frame, and the goal is a
// walkable threshold. Pure function, like the first-person controller.
import type { Point } from "@poltergeist/contracts/common.js";
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { Action } from "@poltergeist/contracts/tick-response.js";
import type { ControllerOutput, ControllerState } from "./controller.js";
import type { Scene } from "./perception/types.js";
import type { Policy } from "./policy.js";

const NOOP: Action = { key: "NOOP", holdMs: 0 };

export const feetMidpoint = (s: Scene): Point => [
  Math.round((s.feet.left[0] + s.feet.right[0]) / 2),
  Math.round((s.feet.left[1] + s.feet.right[1]) / 2),
];

/**
 * The first obstacle that sits on the straight walking corridor from the feet
 * to the goal. The corridor narrows toward the goal (perspective). Obstacles
 * behind the feet or beyond the goal don't count.
 */
export function blockingObstacle(scene: Scene, policy: Policy): { point: Point; side: "left" | "right" } | undefined {
  const n = policy.navigation;
  const goal = scene.goal;
  if (!goal) return undefined;
  const [fy, fx] = feetMidpoint(scene);
  const span = fy - goal[0];
  if (span <= 0) return undefined;

  const ahead = scene.obstacles
    .filter((o) => o.point[0] < fy && o.point[0] > goal[0])
    .sort((a, b) => b.point[0] - a.point[0]); // nearest first
  for (const o of ahead) {
    const f = (fy - o.point[0]) / span; // 0 at the feet, 1 at the goal
    const pathX = fx + f * (goal[1] - fx);
    const halfPath = n.pathHalfWidth * (1 - f * (1 - n.farWidthRatio));
    const halfObstacle = o.box ? (o.box[3] - o.box[1]) / 2 : n.defaultObstacleHalfWidth;
    const offset = o.point[1] - pathX;
    if (Math.abs(offset) < halfPath + halfObstacle) return { point: o.point, side: offset >= 0 ? "right" : "left" };
  }
  return undefined;
}

export function stepNav(prev: ControllerState, scene: Scene, req: TickRequest, policy: Policy): ControllerOutput {
  const n = policy.navigation;
  const s: ControllerState = { ...prev, lost: 0, searchSteps: 0, pending: undefined };
  const out = (action: Action, mode: ControllerOutput["mode"], rationale: string, successClaim = false): ControllerOutput => ({
    state: s,
    action,
    mode,
    rationale: rationale.slice(0, 60),
    successClaim: successClaim && req.driver === "brain",
  });

  // Mid-stumble: don't stack a new move on top of the fall.
  if (scene.pose === "stumbling") {
    s.successTicks = 0;
    return out(NOOP, "unstick", "stumbled, waiting to recover");
  }

  if (!scene.goal) {
    s.successTicks = 0;
    return out(NOOP, "search", "exit threshold not in view");
  }

  // Arrival: the feet themselves reach the threshold (seeing the sign is not enough).
  const mid = feetMidpoint(scene);
  const gap = Math.round(Math.hypot(mid[0] - scene.goal[0], mid[1] - scene.goal[1]));
  if (gap <= n.arriveRadius) {
    s.successTicks += 1;
    if (s.successTicks >= policy.controller.successTicks) {
      return out(NOOP, "success", `feet at exit threshold (gap ${gap})`, true);
    }
    return out(NOOP, "success", `feet at threshold (gap ${gap}), confirming`);
  }
  s.successTicks = 0;

  const block = blockingObstacle(scene, policy);
  if (block) {
    // Step away from the side the obstacle sits on.
    const key = block.side === "right" ? "A" : "D";
    return out({ key, holdMs: n.stepAsideMs }, "track", `obstacle ahead, stepping ${key === "A" ? "left" : "right"}`);
  }

  return out({ key: "W", holdMs: n.walkMs }, "track", `path clear, walking (gap ${gap})`);
}
