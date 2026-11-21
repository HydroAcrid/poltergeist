// Third-person navigation: the avatar's feet are in frame, and the goal is a
// walkable threshold. Pure function, like the first-person controller.
//
// Two corridors run from the feet midpoint:
//   - forward: toward the camera heading (W walks this way), and
//   - to the goal: straight to the exit threshold.
// Obstacles are placed by where they touch the floor (bottom of their box).
import type { Point } from "@poltergeist/contracts/common.js";
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { Action } from "@poltergeist/contracts/tick-response.js";
import type { ControllerOutput, ControllerState } from "./controller.js";
import type { Scene } from "./perception/types.js";
import type { Policy } from "./policy.js";

const NOOP: Action = { key: "NOOP", holdMs: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const feetMidpoint = (s: Scene): Point => [
  Math.round((s.feet.left[0] + s.feet.right[0]) / 2),
  Math.round((s.feet.left[1] + s.feet.right[1]) / 2),
];

/** Where an obstacle meets the floor: bottom-centre of its box, else its point. */
const floorPoint = (o: Scene["obstacles"][number]): Point =>
  o.box ? [o.box[2], Math.round((o.box[1] + o.box[3]) / 2)] : o.point;

export interface Block {
  point: Point;
  /** Obstacle offset from the corridor centre, in frame units (negative = left). */
  offset: number;
  halfWidth: number;
  /** How far along the corridor it touches the floor: 0 at the boots, 1 at the end. */
  along: number;
}

/**
 * The nearest obstacle on the corridor from the feet to `to`. The corridor
 * narrows toward `to` (perspective). Obstacles touching the floor behind the
 * feet or beyond `to` don't count.
 */
export function blockingObstacle(scene: Scene, to: Point, policy: Policy): Block | undefined {
  const n = policy.navigation;
  const pathHalfWidth = n.rig === "shoulder" ? n.shoulder.pathHalfWidth : n.pathHalfWidth;
  const [fy, fx] = feetMidpoint(scene);
  const span = fy - to[0];
  if (span <= 0) return undefined;

  const ahead = scene.obstacles
    .map((o) => ({ o, floor: floorPoint(o) }))
    .filter(({ floor }) => floor[0] < fy && floor[0] > to[0])
    .sort((a, b) => b.floor[0] - a.floor[0]); // nearest first
  for (const { o, floor } of ahead) {
    const f = (fy - floor[0]) / span; // 0 at the feet, 1 at `to`
    const pathX = fx + f * (to[1] - fx);
    const halfPath = pathHalfWidth * (1 - f * (1 - n.farWidthRatio));
    const halfWidth = o.box ? (o.box[3] - o.box[1]) / 2 : n.defaultObstacleHalfWidth;
    const offset = floor[1] - pathX;
    if (Math.abs(offset) < halfPath + halfWidth) return { point: o.point, offset, halfWidth, along: f };
  }
  return undefined;
}

/**
 * Where the robot's forward route reaches the exit's depth (the exit's row).
 * Uses the perceiver's forward floor point when it is ahead of the boots (up
 * the frame), extended so obstacles several strides out still count; ER 2's
 * forward point is typically only about a stride away. A forward point level
 * with or behind the boots is ignored (seen on the live probe), and then the
 * follow camera is assumed to look along the robot (headingX).
 */
export function facingPoint(feet: Point, forward: Point | undefined, goal: Point, headingX: number): Point {
  const ahead = forward && feet[0] - forward[0] >= 10 ? forward : undefined;
  if (!ahead || feet[0] <= goal[0]) return [goal[0], headingX];
  const k = (feet[0] - goal[0]) / (feet[0] - ahead[0]);
  if (k <= 1) return ahead;
  return [goal[0], Math.round(clamp(feet[1] + (ahead[1] - feet[1]) * k, 0, 1000))];
}

/**
 * Shoulder rig only: the robot's body is narrower than the rig assumes, so the
 * camera has drifted wide and the estimated ground anchor is no longer valid.
 */
export function robotTooSmall(scene: Scene, policy: Policy): boolean {
  const n = policy.navigation;
  if (n.rig !== "shoulder" || !scene.robotBox) return false;
  return (scene.robotBox[3] - scene.robotBox[1]) / 1000 < n.shoulder.minRobotWidth;
}

/** The robot's facing point for this scene under the policy's rig (undefined without an exit). */
export function facingFor(scene: Scene, policy: Policy): Point | undefined {
  const n = policy.navigation;
  if (!scene.goal) return undefined;
  const headingX = n.rig === "shoulder" ? n.shoulder.headingX : n.headingX;
  return facingPoint(feetMidpoint(scene), n.useForwardPoint ? scene.forward : undefined, scene.goal, headingX);
}

/**
 * Signed image-space angle from the robot's facing to the exit, as seen from
 * the boots: −1 = 90° left … 0 = straight ahead … 1 = 90° right.
 */
export function bearing(feet: Point, facing: Point, goal: Point): number {
  const angle = (p: Point) => Math.atan2(p[1] - feet[1], feet[0] - p[0]);
  let d = angle(goal) - angle(facing);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return clamp(d / (Math.PI / 2), -1, 1);
}

/**
 * Whether a sidestep to `side` lands on clear floor for the next steps: shift
 * the boots and the facing point sideways by `sidestepShift` and re-check,
 * counting only obstacles within `sidestepWithin` of the way to the exit row
 * (furniture far down the hall doesn't make a side unsafe; it's re-checked as
 * the robot advances). A step that would leave the frame is not clear.
 */
export function sideClear(scene: Scene, facing: Point, side: "left" | "right", policy: Policy): boolean {
  const dx = (side === "left" ? -1 : 1) * policy.navigation.sidestepShift;
  const shift = (p: Point): Point => [p[0], p[1] + dx];
  const feet = { left: shift(scene.feet.left), right: shift(scene.feet.right) };
  if ([feet.left[1], feet.right[1]].some((x) => x < 0 || x > 1000)) return false;
  const block = blockingObstacle({ ...scene, feet }, shift(facing), policy);
  return !block || block.along > policy.navigation.sidestepWithin;
}

function clock(e: number): string {
  const h = Math.round(e * 3);
  return `${h === 0 ? 12 : h > 0 ? h : 12 + h} o'clock`;
}

export function stepNav(prev: ControllerState, scene: Scene, req: TickRequest, policy: Policy): ControllerOutput {
  const n = policy.navigation;
  const wasStumbling = prev.stumbling === true;
  const s: ControllerState = { ...prev, lost: 0, searchSteps: 0, pending: undefined, stumbling: scene.pose === "stumbling" };
  // TickLog `reaction`: a stumble on its first tick, recovery on the first upright tick after.
  let reaction: ControllerOutput["reaction"] =
    scene.pose === "stumbling" ? (wasStumbling ? undefined : "stumble") : wasStumbling ? "recover" : undefined;
  const out = (action: Action, mode: ControllerOutput["mode"], rationale: string, successClaim = false): ControllerOutput => ({
    state: s,
    action,
    mode,
    rationale: rationale.slice(0, 60),
    successClaim: successClaim && req.driver === "brain",
    ...(reaction ? { reaction } : {}),
  });

  // Mid-stumble: don't stack a new move on top of the fall.
  if (scene.pose === "stumbling") {
    s.successTicks = 0;
    return out(NOOP, "unstick", "stumbled, waiting to recover");
  }

  // Camera drifted wide (shoulder rig): the ground estimate is wrong, so hold.
  if (robotTooSmall(scene, policy)) {
    s.successTicks = 0;
    return out(NOOP, "search", "robot too small in frame, holding");
  }

  const goal = scene.goal;
  if (!goal) {
    s.successTicks = 0;
    return out(NOOP, "search", "exit threshold not in view");
  }

  // Arrival: the feet themselves reach the threshold (seeing the sign is not
  // enough). With the shoulder rig the boots are hidden, so the threshold must
  // reach the foreground under the robot instead; World confirms the crossing.
  const mid = feetMidpoint(scene);
  const gap = Math.round(Math.hypot(mid[0] - goal[0], mid[1] - goal[1]));
  const atThreshold = n.rig === "shoulder" ? goal[0] >= n.shoulder.arriveRow : gap <= n.arriveRadius;
  if (atThreshold) {
    s.successTicks += 1;
    const where = n.rig === "shoulder" ? "exit threshold underfoot" : `feet at exit threshold (gap ${gap})`;
    if (s.successTicks >= policy.controller.successTicks) return out(NOOP, "success", where, true);
    return out(NOOP, "success", `${where}, confirming`);
  }
  s.successTicks = 0;

  const headingX = n.rig === "shoulder" ? n.shoulder.headingX : n.headingX;
  const facing = facingPoint(mid, n.useForwardPoint ? scene.forward : undefined, goal, headingX);
  const e = bearing(mid, facing, goal);
  const forward = blockingObstacle(scene, facing, policy);
  const toGoal = blockingObstacle(scene, goal, policy);

  // Projector option: when a grounded obstacle blocks the next steps, prefer a
  // visible A/D sidestep onto a clear side (toward the exit's side first). If
  // neither side is open, turn instead (below, or look away from the obstacle).
  if (n.preferSidestep && forward && forward.along <= n.sidestepWithin) {
    const towardExit: "left" | "right" = e < 0 ? "left" : "right";
    const other: "left" | "right" = towardExit === "left" ? "right" : "left";
    const side = [towardExit, other].find((sd) => sideClear(scene, facing, sd, policy));
    reaction ??= "avoid";
    if (side) {
      return out({ key: side === "left" ? "A" : "D", holdMs: n.stepAsideMs }, "track", `obstacle ahead, stepping ${side}`);
    }
    if (toGoal || Math.abs(e) <= n.turnDeadband) {
      const key = forward.offset > 0 ? "ArrowLeft" : "ArrowRight";
      return out({ key, holdMs: Math.round(clamp(n.kTurn / 3, 120, n.maxTurnMs)) }, "track", "blocked both sides, looking for a way");
    }
  }

  // Exit is off to one side and the way there is clear: turn toward it.
  if (Math.abs(e) > n.turnDeadband && !toGoal) {
    const key = e > 0 ? "ArrowRight" : "ArrowLeft";
    const why = forward ? "obstacle ahead, turning toward exit" : `exit ${clock(e)} → turning`;
    if (forward) reaction ??= "avoid";
    return out({ key, holdMs: Math.round(clamp(n.kTurn * Math.abs(e), 120, n.maxTurnMs)) }, "track", why);
  }

  // Straight ahead is blocked: step aside. Roughly dead-centre → step toward the
  // exit's side; otherwise step away from the obstacle.
  if (forward) {
    const centred = Math.abs(forward.offset) < forward.halfWidth / 2;
    const left = centred ? e < 0 : forward.offset > 0;
    reaction ??= "avoid";
    return out({ key: left ? "A" : "D", holdMs: n.stepAsideMs }, "track", `obstacle ahead, stepping ${left ? "left" : "right"}`);
  }

  // The gap means nothing when the boots are an estimate (shoulder rig).
  return out({ key: "W", holdMs: n.walkMs }, "track", n.rig === "shoulder" ? "path clear, walking" : `path clear, walking (gap ${gap})`);
}
