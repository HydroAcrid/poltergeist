// Decision mode "model": the player model chooses the move from what it saw
// change between frames; Brain turns that into a key hold and lets geometry
// veto only a step into something solid. No per-object rules live here: the
// model labels each obstacle solid or not, and that is all geometry consults.
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { Action, Intent } from "@poltergeist/contracts/tick-response.js";
import type { ControllerOutput, ControllerState } from "./controller.js";
import { blockingObstacle, facingFor, sideClear, stepNav } from "./navigate.js";
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
  const reset = { ...geo.state, holdStreak: 0 };
  const meta = {
    intent: decision.intent,
    ...(decision.target ? { target: decision.target } : {}),
    observed: decision.observed,
    blocked: blockedAhead,
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

  const chosen = motor(decision.intent, policy);
  const key = chosen.action.key;
  const vetoed =
    (key === "W" && blockedAhead) ||
    (key === "A" && !sideClear(solid, facing!, "left", policy)) ||
    (key === "D" && !sideClear(solid, facing!, "right", policy));
  if (vetoed) {
    const said = decision.intent.replace("_", " ");
    return { ...geo, state: reset, rationale: `${said} blocked, ${geo.rationale}`.slice(0, 60), reaction: "avoid", decision: { ...meta, source: "veto" } };
  }

  // The model's move. Keep stepNav's state bookkeeping (stumble/recover memory).
  const reaction = geo.reaction === "recover" ? "recover" : decision.avoiding ? "avoid" : undefined;
  return {
    state: { ...geo.state, holdStreak: holds },
    action: chosen.action,
    mode: chosen.mode,
    rationale: decision.reason.slice(0, 60),
    successClaim: false,
    ...(reaction ? { reaction } : {}),
    decision: { ...meta, source: "model" },
  };
}
