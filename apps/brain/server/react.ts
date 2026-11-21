// Decision mode "model": the player model chooses the move from what it saw
// change between frames; Brain turns that into a key hold and lets geometry
// veto only a step into something solid. No per-object rules live here: the
// model labels each obstacle solid or not, and that is all geometry consults.
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { Action, Intent } from "@poltergeist/contracts/tick-response.js";
import type { ControllerOutput, ControllerState } from "./controller.js";
import { blockingObstacle, facingFor, robotTooSmall, sideClear, stepNav } from "./navigate.js";
import type { ModelDecision, Scene } from "./perception/types.js";
import type { Policy } from "./policy.js";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The supported motor actions: one Key hold each. */
export function motor(intent: Intent, policy: Policy): { action: Action; mode: ControllerOutput["mode"] } {
  const n = policy.navigation;
  const turnMs = Math.round(clamp(n.kTurn / 4, 120, n.maxTurnMs)); // ≈ 22° of camera pan
  switch (intent) {
    case "walk": return { action: { key: "W", holdMs: n.walkMs }, mode: "track" };
    case "step_left": return { action: { key: "A", holdMs: n.stepAsideMs }, mode: "track" };
    case "step_right": return { action: { key: "D", holdMs: n.stepAsideMs }, mode: "track" };
    case "turn_left": return { action: { key: "ArrowLeft", holdMs: turnMs }, mode: "track" };
    case "turn_right": return { action: { key: "ArrowRight", holdMs: turnMs }, mode: "track" };
    case "back_up": return { action: { key: "S", holdMs: 400 }, mode: "unstick" };
    case "hold": return { action: { key: "NOOP", holdMs: 0 }, mode: "track" };
  }
}

const INTENT_OF: Record<string, Intent> = { W: "walk", A: "step_left", D: "step_right", ArrowLeft: "turn_left", ArrowRight: "turn_right", S: "back_up", NOOP: "hold" };

export function stepReact(prev: ControllerState, scene: Scene, decision: ModelDecision, req: TickRequest, policy: Policy): ControllerOutput {
  // Geometry only sees what the model judged solid.
  const solid: Scene = { ...scene, obstacles: scene.obstacles.filter((o) => o.solid !== false) };
  const geo = stepNav(prev, solid, req, policy);
  const n = policy.navigation;
  const facing = scene.goal ? facingFor(solid, policy)! : undefined;
  const blockedAhead = (() => {
    if (!facing) return false;
    const b = blockingObstacle(solid, facing, policy);
    return b !== undefined && b.along <= n.sidestepWithin;
  })();
  const reset: ControllerState = { ...geo.state, holdStreak: 0, plan: undefined };
  const meta = {
    intent: decision.intent,
    ...(decision.target ? { target: decision.target } : {}),
    observed: decision.observed,
    blocked: blockedAhead,
    ...(decision.then ? { next: decision.then } : {}),
  };

  // More than one robot matching the player: can't tell which one is ours. Hold.
  if ((decision.robotCount ?? 1) > 1) {
    return {
      state: reset,
      action: { key: "NOOP", holdMs: 0 },
      mode: "search",
      rationale: `${decision.robotCount} robots visible, holding`,
      successClaim: false,
      decision: { ...meta, source: "geometry", intent: "hold" },
    };
  }

  // Camera drifted wide (shoulder rig): the ground estimate is wrong. Hold.
  if (robotTooSmall(scene, policy)) {
    return {
      state: reset,
      action: { key: "NOOP", holdMs: 0 },
      mode: "search",
      rationale: "robot too small in frame, holding",
      successClaim: false,
      decision: { ...meta, source: "geometry", intent: "hold" },
    };
  }

  // Fixed rules still own these: mid-stumble hold, arrival, exit not in view.
  if (scene.pose === "stumbling" || geo.mode === "success" || !scene.goal) {
    return { ...geo, state: reset, decision: { ...meta, source: "geometry", intent: INTENT_OF[geo.action.key] ?? "hold" } };
  }

  // Cap the model's own holds so a hazard that never goes away can't freeze the
  // robot. Past the cap, geometry moves (around anything the model called
  // solid); the streak resets so the model decides again next tick.
  const holds = decision.intent === "hold" ? (prev.holdStreak ?? 0) + 1 : 0;
  if (holds > policy.decision.maxHolds) {
    return {
      ...geo,
      state: reset,
      rationale: `waited ${holds - 1} ticks, ${geo.rationale}`.slice(0, 60),
      decision: { ...meta, source: "geometry", intent: INTENT_OF[geo.action.key] ?? "hold" },
    };
  }

  // Steadiness: a non-urgent change of plan waits for a second look that agrees.
  // Urgent (switch now): no plan yet, same intent, a hold, resuming from a hold,
  // or a newly avoided hazard. Otherwise keep the plan and remember the proposal.
  const plan = prev.plan;
  const urgent =
    !plan || decision.intent === plan.intent || decision.intent === "hold" || plan.intent === "hold" ||
    (decision.avoiding && !plan.avoiding);
  let intent: Intent = decision.intent;
  let steadied = false;
  let pending: Intent | undefined;
  if (policy.decision.steady && plan && !urgent && plan.pending !== decision.intent) {
    intent = plan.intent;
    steadied = true;
    pending = decision.intent;
  }

  const chosen = motor(intent, policy);
  const key = chosen.action.key;
  const vetoed =
    (key === "W" && blockedAhead) ||
    (key === "A" && !sideClear(solid, facing!, "left", policy)) ||
    (key === "D" && !sideClear(solid, facing!, "right", policy));
  if (vetoed) {
    const said = intent.replace("_", " ");
    return { ...geo, state: reset, rationale: `${said} blocked, ${geo.rationale}`.slice(0, 60), reaction: "avoid", decision: { ...meta, source: "veto" } };
  }

  // The move (the model's, or the kept plan). Keep stepNav's bookkeeping.
  const clear = facing
    ? { walk: !blockedAhead, left: sideClear(solid, facing, "left", policy), right: sideClear(solid, facing, "right", policy) }
    : { walk: false, left: false, right: false };
  const nextPlan: ControllerState["plan"] = {
    intent,
    avoiding: steadied ? plan!.avoiding : decision.avoiding,
    ...(pending ? { pending } : {}),
    ...(decision.then ? { next: decision.then } : {}),
    at: req.t,
    clear,
  };
  const reaction = geo.reaction === "recover" ? "recover" : !steadied && decision.avoiding ? "avoid" : undefined;
  const said = (i: Intent) => i.replace("_", " ");
  return {
    state: { ...geo.state, holdStreak: holds, plan: nextPlan },
    action: chosen.action,
    mode: chosen.mode,
    rationale: steadied ? `keeping ${said(intent)}; 2nd look before ${said(decision.intent)}`.slice(0, 60) : decision.reason.slice(0, 60),
    successClaim: false,
    ...(reaction ? { reaction } : {}),
    decision: { ...meta, source: steadied ? "steady" : "model" },
  };
}

/**
 * The look for this tick failed or came back too late: carry out the model's
 * planned follow-up move if it is recent and the last scene showed it clear.
 * Returns undefined when there is no safe planned move (the caller falls back).
 */
export function planFallback(prev: ControllerState, req: TickRequest, policy: Policy): ControllerOutput | undefined {
  const plan = prev.plan;
  if (!policy.decision.useNext || !plan?.next || req.t - plan.at > policy.decision.nextMaxAgeMs) return undefined;
  const next = plan.next;
  const safe =
    (next !== "walk" || plan.clear.walk) && (next !== "step_left" || plan.clear.left) && (next !== "step_right" || plan.clear.right);
  if (!safe) return undefined;
  const chosen = motor(next, policy);
  return {
    state: { ...prev, holdStreak: 0, plan: { ...plan, intent: next, next: undefined, pending: undefined, at: req.t } },
    action: chosen.action,
    mode: "fallback",
    rationale: `look late, doing planned ${next.replace("_", " ")}`.slice(0, 60),
    successClaim: false,
    decision: { source: "steady", intent: next },
  };
}
