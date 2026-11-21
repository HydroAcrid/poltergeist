// Referee, deterministic rule first (apps/crowd/CLAUDE.md "Referee"). The model judge only explains
// or overrules with visible evidence later; the rule's verdict is the contract.
import type { HauntTag } from "@poltergeist/contracts/common.js";
import type { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import type { Verdict } from "@poltergeist/contracts/verdict.js";

/** The TickLog fields the referee reads (Brain's C06; `reaction` is 1.1.0, `decision` is 1.2.0). */
export interface RefDecision {
  source: "model" | "veto" | "geometry" | string;
  intent: string;
  target?: [number, number];
  observed?: string;
  blocked?: boolean;
}
export interface RefTick {
  seq: number;
  t: number;
  perception: { visible: boolean; conf: number };
  action: { key: string; holdMs: number };
  mode: string;
  rationale?: string;
  reaction?: "avoid" | "stumble" | "recover" | "unclear" | string;
  decision?: RefDecision;
}
export interface RefInjected {
  hauntId: string;
  t: number;
  ok: boolean;
}
export interface RefHaunt {
  hauntId: string;
  moderated?: { tags?: HauntTag[]; text?: string };
}
export interface RefereeInput {
  episode: Pick<Episode, "episodeId">;
  ended: Pick<EpisodeEnded, "episodeId" | "reason" | "durationMs" | "hallway">;
  ticks: RefTick[];
  injected: RefInjected[];
  haunts: RefHaunt[];
}

/** Tags that can plausibly explain losing sight of the target. `audio` and `other` can't. */
export const VISUAL_TAGS: ReadonlySet<HauntTag> = new Set(["visibility", "lighting", "occlusion", "geometry", "distractor", "sign_change", "weather"]);
const ADVERSARY_BEFORE_MS = 8000;
const ADVERSARY_AFTER_MS = 1000;
const CONFIDENT = 0.7;

const lostTick = (k: RefTick) => !k.perception.visible || k.mode === "search" || k.mode === "unstick";

/** Index where L starts: the final run of "lost" ticks ending at the last tick (length if L is empty). */
function lostRunStart(ticks: RefTick[]): number {
  let i = ticks.length;
  while (i > 0 && lostTick(ticks[i - 1]!)) i--;
  return i;
}

/** failureT per the lane guide: never visible → 0; L empty → last tick t; else first tick of L. */
export function failureTime(ticks: RefTick[]): number {
  const sorted = [...ticks].sort((a, b) => a.seq - b.seq);
  if (!sorted.some((k) => k.perception.visible)) return 0;
  const start = lostRunStart(sorted);
  if (start >= sorted.length) return sorted.at(-1)?.t ?? 0;
  return sorted[start]!.t;
}

/** A small action: NOOP, a turn held ≤ 150 ms, or W/S held ≤ 400 ms. */
function smallAction(a: { key: string; holdMs: number }): boolean {
  if (a.key === "NOOP") return true;
  if (["ArrowLeft", "ArrowRight", "A", "D"].includes(a.key)) return a.holdMs <= 150;
  if (a.key === "W" || a.key === "S") return a.holdMs <= 400;
  return false;
}

const clip = (s: string) => (s.length > 80 ? s.slice(0, 79) + "…" : s);
const secs = (ms: number) => (ms / 1000).toFixed(1) + " s";
const DECISION_NEAR_MS = 2000;

/** Optional judge evidence from the nearest TickLog.decision at failureT (blame rule stays unchanged). */
function decisionEvidence(ticks: RefTick[], failureT: number): { t: number; note: string } | undefined {
  const withDecision = ticks.filter((k) => k.decision !== undefined);
  if (withDecision.length === 0) return undefined;
  const nearest = withDecision.reduce((best, k) =>
    Math.abs(k.t - failureT) < Math.abs(best.t - failureT) ? k : best,
  );
  if (Math.abs(nearest.t - failureT) > DECISION_NEAR_MS) return undefined;
  const d = nearest.decision!;
  if (d.source === "model" && d.intent === "hold") {
    return { t: failureT, note: "Brain chose to hold" };
  }
  if (d.source === "geometry" && d.intent === "hold" && /\brobots visible, holding\b/i.test(nearest.rationale ?? "")) {
    return { t: failureT, note: "Brain held: more than one robot in view" };
  }
  if (d.source === "veto") {
    return { t: failureT, note: "Brain avoided a solid obstacle" };
  }
  return undefined;
}

function withDecisionNote(
  evidence: { t: number; note: string }[],
  ticks: RefTick[],
  failureT: number,
): { t: number; note: string }[] {
  const extra = decisionEvidence(ticks, failureT);
  return (extra ? [...evidence, extra] : evidence).slice(0, 5);
}

export function ruleVerdict(input: RefereeInput, now: number): Verdict {
  const { ended } = input;
  const base = { episodeId: input.episode.episodeId, stage: "provisional" as const, overrodeRule: false, model: "rule", createdAt: now };

  if (ended.hallway) {
    const { reason, reactions } = ended.hallway;
    const recorded = { ...base, hallway: ended.hallway, confidence: 1 };
    const t = ended.durationMs;
    if (reason === "exit")
      return { ...recorded, outcome: "success", evidence: [{ t, note: "The robot reached the exit" }] };
    if (reason === "interrupted")
      return { ...recorded, outcome: "aborted", evidence: [{ t, note: "The hallway closed before a winner was determined" }] };
    if (reason === "time")
      return { ...recorded, outcome: "failure", failureT: t, blame: "agent", ruleBlame: "agent",
        evidence: [{ t, note: "The timer expired before the robot reached the exit" }] };
    const lastScare = reactions.filter(r => r.kind === "scare").sort((a, b) => b.at - a.at)[0];
    if (lastScare)
      return { ...recorded, outcome: "failure", failureT: t, blame: "adversary", ruleBlame: "adversary",
        culpritHauntId: lastScare.hauntId, evidence: [{ t, note: "The robot reached the fear limit" }] };
  }

  if (ended.reason === "success_claim") {
    const last = [...input.ticks].sort((a, b) => a.seq - b.seq).at(-1);
    return { ...base, outcome: "success", evidence: last ? [{ t: last.t, note: "Robot claimed arrival at the exit" }] : [], confidence: 0.8 };
  }
  if ((ended.reason === "operator_stop" || ended.reason === "error" || ended.reason === "watchdog") && ended.durationMs < 10000) {
    return { ...base, outcome: "aborted", evidence: [], confidence: 0.5 };
  }

  const ticks = [...input.ticks].sort((a, b) => a.seq - b.seq);
  const everVisible = ticks.some((k) => k.perception.visible);
  const start = lostRunStart(ticks);
  const lost = everVisible && start < ticks.length;
  const failureT = failureTime(ticks);
  const tagsOf = new Map(input.haunts.map((h) => [h.hauntId, h.moderated?.tags ?? []]));
  const textOf = new Map(input.haunts.map((h) => [h.hauntId, h.moderated?.text ?? "a haunting"]));

  // a. adversary: target was lost, and a visual haunting was injected in [failureT − 8 s, failureT + 1 s]
  const culprit = lost
    ? input.injected
        .filter((h) => h.ok && h.t >= failureT - ADVERSARY_BEFORE_MS && h.t <= failureT + ADVERSARY_AFTER_MS)
        .filter((h) => (tagsOf.get(h.hauntId) ?? []).some((t) => VISUAL_TAGS.has(t)))
        .sort((a, b) => b.t - a.t)[0]
    : undefined;
  if (culprit) {
    return {
      ...base, outcome: "failure", failureT, blame: "adversary", ruleBlame: "adversary", culpritHauntId: culprit.hauntId, confidence: 0.6,
      evidence: withDecisionNote([
        { t: culprit.t, note: clip(`Injected: ${textOf.get(culprit.hauntId)}`) },
        { t: failureT, note: `Target lost ${secs(failureT - culprit.t)} later` },
      ], ticks, failureT),
    };
  }

  // b. world: the target was confidently visible right before L and the robot barely moved
  const before = lost && start > 0 ? ticks[start - 1] : undefined;
  if (before && before.perception.visible && before.perception.conf >= CONFIDENT && smallAction(before.action)) {
    return {
      ...base, outcome: "failure", failureT, blame: "world", ruleBlame: "world", confidence: 0.5,
      evidence: withDecisionNote([
        { t: before.t, note: clip(`Target visible (conf ${before.perception.conf.toFixed(2)}), action ${before.action.key}`) },
        { t: failureT, note: "Target gone with no haunting and no large move" },
      ], ticks, failureT),
    };
  }

  // c. agent: everything else, including never-seen and "tracked but slow" (target stayed visible)
  const baseEvidence = !everVisible
    ? [{ t: 0, note: "Target never visible this round" }]
    : !lost
      ? [{ t: failureT, note: "Target stayed visible until time ran out" }]
      : [{ t: failureT, note: before ? clip(`Target lost after ${before.action.key} ${before.action.holdMs} ms`) : "Target lost" }];
  return {
    ...base,
    outcome: "failure",
    failureT,
    blame: "agent",
    ruleBlame: "agent",
    confidence: 0.5,
    evidence: withDecisionNote(baseEvidence, ticks, failureT),
  };
}
