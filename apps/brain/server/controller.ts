// The player's hands: a pure function (state, seen, req, policy) → next step.
import type { Point } from "@poltergeist/contracts/common.js";
import type { TickRequest } from "@poltergeist/contracts/tick-request.js";
import type { Action, TickMode } from "@poltergeist/contracts/tick-response.js";
import type { Resolved } from "./perception/resolve.js";
import type { Policy } from "./policy.js";

export interface ControllerState {
  emaPoint?: Point;
  lost: number;
  searchSteps: number;
  stuckTicks: number;
  successTicks: number;
  verifySteps: number;
  /** Second half of a two-tick unstick. */
  pending?: Action;
  lastTrack?: { action: Action; t: number };
}

export interface ControllerOutput {
  state: ControllerState;
  action: Action;
  mode: TickMode;
  rationale: string;
  successClaim: boolean;
}

export const initialState = (): ControllerState => ({ lost: 0, searchSteps: 0, stuckTicks: 0, successTicks: 0, verifySteps: 0 });

const NOOP: Action = { key: "NOOP", holdMs: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hold = (key: Action["key"], ms: number): Action => ({ key, holdMs: Math.round(clamp(ms, 0, 1500)) });
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clip = (s: string) => (s.length <= 60 ? s : `${s.slice(0, 59)}…`);

/** Bearing as a clock position: e = −1 (far left) … 0 (ahead) … 1 (far right). */
function clock(e: number): string {
  const h = Math.round(e * 3);
  return `${h === 0 ? 12 : h > 0 ? h : 12 + h} o'clock`;
}

export function step(prev: ControllerState, seen: Resolved, req: TickRequest, policy: Policy): ControllerOutput {
  const c = policy.controller;
  const s: ControllerState = { ...prev };
  const out = (action: Action, mode: TickMode, rationale: string, successClaim = false): ControllerOutput => ({
    state: s,
    action,
    mode,
    rationale: clip(rationale),
    successClaim: successClaim && req.driver === "brain",
  });

  // Fallback: perception failed or timed out.
  if (seen.perception.error) {
    const last = s.lastTrack;
    if (last && last.action.key !== "NOOP" && req.t - last.t < 1500) {
      return out(hold(last.action.key, last.action.holdMs / 2), "fallback", "perception failed, easing last move");
    }
    return out(NOOP, "fallback", "perception failed, holding still");
  }

  // Finish a two-tick unstick.
  if (s.pending) {
    const action = s.pending;
    s.pending = undefined;
    return out(action, "unstick", "stuck, turning away");
  }

  // Unstick: pushing W but the frame isn't changing.
  s.stuckTicks = req.executing?.key === "W" && req.frameDiff < c.stuckDiffThreshold ? s.stuckTicks + 1 : 0;
  if (s.stuckTicks >= c.stuckTicks) {
    s.stuckTicks = 0;
    s.successTicks = 0;
    s.emaPoint = undefined;
    s.pending = hold("ArrowLeft", 300);
    return out(hold("S", 400), "unstick", "stuck, backing up");
  }

  let perception = seen.perception;

  // Several look-alike targets: change the viewing angle before committing.
  if (seen.ambiguous && seen.ambiguous.length >= 2) {
    s.successTicks = 0;
    if (s.verifySteps < c.verifyMaxSteps) {
      s.verifySteps += 1;
      return out(hold(c.verifyKey, c.verifyHoldMs), "search", `${seen.ambiguous.length} doors, side-stepping to check depth`);
    }
    // Out of verification steps: commit to the most confident candidate.
    const best = [...seen.ambiguous].sort((a, b) => b.conf - a.conf)[0]!;
    perception = { ...perception, visible: true, point: best.point, ...(best.box ? { box: best.box } : {}), conf: best.conf };
  }

  // Search: target not visible.
  if (!perception.visible || !perception.point) {
    s.lost += 1;
    s.successTicks = 0;
    if (s.lost < c.lostTicksBeforeSearch) return out(NOOP, "search", "lost target, looking");
    if (s.searchSteps >= c.searchMaxSteps) {
      s.searchSteps = 0;
      return out(hold("W", c.exploreFwdMs), "search", "lost target, exploring forward");
    }
    s.searchSteps += 1;
    return out(hold("ArrowRight", c.searchStepMs), "search", "lost target, scanning");
  }

  // Track: smooth the point, reject implausible jumps unless confident.
  s.lost = 0;
  s.searchSteps = 0;
  const p = perception.point;
  if (!s.emaPoint) s.emaPoint = p;
  else if (dist(p, s.emaPoint) <= c.maxPointJump || perception.conf >= 0.8) {
    const a = c.emaAlpha;
    s.emaPoint = [Math.round(a * p[0] + (1 - a) * s.emaPoint[0]), Math.round(a * p[1] + (1 - a) * s.emaPoint[1])];
  }
  const e = (s.emaPoint[1] - 500) / 500;
  const boxH = perception.box ? (perception.box[2] - perception.box[0]) / 1000 : undefined;

  // Success: big enough and centred for enough consecutive ticks.
  s.successTicks = boxH !== undefined && boxH >= c.successBoxHeight && Math.abs(e) < c.successCenter ? s.successTicks + 1 : 0;
  if (s.successTicks >= c.successTicks) {
    s.lastTrack = undefined;
    return out(NOOP, "success", req.driver === "brain" ? "at the door" : "at the door (human driving)", true);
  }

  const action =
    Math.abs(e) > c.yawDeadband
      ? hold(e > 0 ? "ArrowRight" : "ArrowLeft", clamp(c.kYaw * Math.abs(e), 120, 600))
      : hold("W", boxH !== undefined ? clamp(c.kFwd * (1 - boxH), 300, 1200) : c.defaultFwdMs);
  s.lastTrack = { action, t: req.t };
  const rationale = action.key === "W" ? "door ahead → walking" : `door ${clock(e)} → turning`;
  return out(action, "track", rationale);
}
