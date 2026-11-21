// Conductor v0 (proposal): picks the next audience idea from the approved pool using
// what World can see right now. Deterministic rules decide; an optional agent may
// only re-rank among ideas the rules already allow. With no fresh scene data it is FIFO.
//
// Not wired into the scheduler yet: needs World's `scene.observed` (see docs/conductor.md).
import type { HauntTag } from "@poltergeist/contracts/common.js";

export type EffectKind = "floor_prop" | "airborne" | "lighting" | "visibility" | "sign" | "audio" | "overhead" | "other";

/** Proposed World → Crowd observation (World-owned shape; see docs/conductor.md). */
export interface SceneObservation {
  t: number; // ms since episode start
  observedAt: number; // epoch ms
  robotProgress?: number; // 0 = start of the aisle, 1 = signed exit threshold
  timeRemainingMs: number;
  cameraStable: boolean;
  obstacles: { label: string; kind: EffectKind; inBeam: boolean; progress?: number }[];
  producible: EffectKind[]; // effect kinds World can render and the camera can show right now
  seenHauntIds: string[]; // hauntings World has visual evidence for
}

export interface Candidate {
  hauntId: string;
  createdAt: number;
  text: string; // moderated, display-safe
  tags: HauntTag[];
  preset?: string;
  skips: number; // times it was eligible but not picked
  authorPicksThisRound: number; // fair airtime: picks already given to this idea's author this round
}

export interface RecentHaunt {
  hauntId: string;
  kind: EffectKind;
  primaryTag: HauntTag;
  sentAt: number; // epoch ms
  seen: boolean;
}

export type WaitCode = "too_late" | "not_in_shot" | "redundant" | "landing" | "no_view";

export interface Decision {
  mode: "conductor" | "fifo";
  pick?: { hauntId: string; reason: string };
  waiting: { hauntId: string; code: WaitCode | "ranked_lower"; reason: string }[];
}

export const POLICY = {
  sceneMaxAgeMs: 3_000, // older scene data → FIFO
  minTimeLeftMs: 10_000, // nothing new in the last 10 s
  latestProgress: { floor_prop: 0.7, airborne: 0.8, lighting: 0.85, visibility: 0.85, sign: 0.85, audio: 0.9, overhead: 0.7, other: 0.8 } as Record<EffectKind, number>,
  roomyProgress: 0.55, // props land ≥ several strides ahead with room to react
  landingWindowMs: 12_000, // wait for the last trick to be seen before stacking a same-kind one
  starveAfterMs: 60_000,
  priorityAfterSkips: 2,
  agentBudgetMs: 500,
};

const PRESET_KIND: Record<string, EffectKind> = {
  "banana-peel": "floor_prop", "mop-bucket": "floor_prop", "chair-tips": "floor_prop", marbles: "floor_prop",
  "paper-gust": "airborne", balloons: "airborne",
  "lights-flicker": "lighting", "power-cut": "lighting",
  fog: "visibility", "painted-door": "sign",
};

export function kindOf(c: { preset?: string; tags: HauntTag[]; text: string }): EffectKind {
  if (c.preset && PRESET_KIND[c.preset]) return PRESET_KIND[c.preset]!;
  if (/ceiling|chandelier|overhead|roof|from above/i.test(c.text)) return "overhead";
  if (/balloon|paper|leaves|confetti|gust|\bwind(?:s|y|storm)?\b(?![- ]?up\b)/i.test(c.text)) return "airborne";
  if (c.tags.includes("lighting")) return "lighting";
  if (c.tags.includes("visibility")) return "visibility";
  if (c.tags.includes("sign_change")) return "sign";
  if (c.tags.includes("geometry") || c.tags.includes("distractor")) return "floor_prop";
  if (c.tags.includes("audio")) return "audio";
  return "other";
}

/** Short public reasons people can check against the shot (≤ 60 chars, display-safe, fixed templates). */
export const REASON: Record<EffectKind, string> = {
  floor_prop: "The aisle ahead is open and the beam will catch it",
  airborne: "It will drift across the beam in front of the robot",
  lighting: "The whole hallway will show the change",
  visibility: "It will roll right through the flashlight beam",
  sign: "The side wall is in the shot",
  audio: "The robot can react to the sound",
  overhead: "The ceiling is in the shot",
  other: "It fits the current shot",
};

const fifo = (a: Candidate, b: Candidate) => a.createdAt - b.createdAt || (a.hauntId < b.hauntId ? -1 : 1);

export function conduct(candidates: Candidate[], scene: SceneObservation | undefined, recent: RecentHaunt[], now: number): Decision {
  const ordered = [...candidates].sort(fifo);
  if (ordered.length === 0) return { mode: scene ? "conductor" : "fifo", waiting: [] };

  // Deterministic fallback: no scene, or stale scene → FIFO, exactly as today.
  if (!scene || now - scene.observedAt > POLICY.sceneMaxAgeMs) {
    const [first, ...rest] = ordered;
    return {
      mode: "fifo",
      pick: { hauntId: first!.hauntId, reason: "Next in line" },
      waiting: rest.map((c) => ({ hauntId: c.hauntId, code: "ranked_lower", reason: "In line" })),
    };
  }

  if (!scene.cameraStable) {
    return { mode: "conductor", waiting: ordered.map((c) => ({ hauntId: c.hauntId, code: "no_view", reason: "Waiting for a clear view" })) };
  }

  const waiting: Decision["waiting"] = [];
  const feasible: { c: Candidate; kind: EffectKind; score: number; why: string; priority: boolean }[] = [];
  const lastTwoTags = recent.slice(-2).map((r) => r.primaryTag);

  for (const c of ordered) {
    const kind = kindOf(c);
    if (!scene.producible.includes(kind)) {
      waiting.push({ hauntId: c.hauntId, code: "not_in_shot", reason: "Great idea, but this camera can't show it" });
      continue;
    }
    if (scene.timeRemainingMs < POLICY.minTimeLeftMs || (scene.robotProgress !== undefined && scene.robotProgress > POLICY.latestProgress[kind])) {
      waiting.push({ hauntId: c.hauntId, code: "too_late", reason: "Too close to the exit for this one" });
      continue;
    }
    const blocking = scene.obstacles.find((o) => o.inBeam && o.kind === kind);
    if (blocking) {
      waiting.push({ hauntId: c.hauntId, code: "redundant", reason: `A ${blocking.label} already fills the beam` });
      continue;
    }
    const landing = recent.find((r) => !r.seen && r.kind === kind && now - r.sentAt < POLICY.landingWindowMs);
    if (landing) {
      waiting.push({ hauntId: c.hauntId, code: "landing", reason: "Waiting for the last trick to land" });
      continue;
    }
    const novel = !lastTwoTags.includes(c.tags[0]!);
    const roomy = kind === "lighting" || kind === "visibility" || (scene.robotProgress !== undefined && scene.robotProgress <= POLICY.roomyProgress);
    const starving = now - c.createdAt >= POLICY.starveAfterMs;
    const fresh = c.authorPicksThisRound === 0; // fair airtime
    const score = (novel ? 2 : 0) + (roomy ? 1 : 0) + (fresh ? 1 : 0) + (starving ? 1 : 0);
    const priority = c.skips >= POLICY.priorityAfterSkips;
    const why = kind === "floor_prop" && scene.robotProgress === undefined ? "A floor obstacle fits this shot" : REASON[kind];
    feasible.push({ c, kind, score, why, priority });
  }

  // Starvation guard first (oldest priority idea), then score, then FIFO.
  feasible.sort((a, b) => Number(b.priority) - Number(a.priority) || b.score - a.score || fifo(a.c, b.c));
  const [best, ...others] = feasible;
  for (const o of others) waiting.push({ hauntId: o.c.hauntId, code: "ranked_lower", reason: "Good one, queued behind the pick" });
  waiting.sort((a, b) => fifo(ordered.find((c) => c.hauntId === a.hauntId)!, ordered.find((c) => c.hauntId === b.hauntId)!));
  return { mode: "conductor", ...(best ? { pick: { hauntId: best.c.hauntId, reason: best.why } } : {}), waiting };
}

/**
 * Optional managed-agent ranking. The agent sees only the rule-feasible ideas and answers within
 * POLICY.agentBudgetMs with a ranked list of their ids, each with a short reason. Crowd takes the
 * first id that is still feasible; the agent's reason is used only if it passes `isSafeReason`
 * (otherwise the rule's fixed reason is shown). Slow, failed or invalid answers keep the
 * deterministic pick.
 */
export async function withAgent(
  decision: Decision,
  agent: ((feasibleIds: string[]) => Promise<{ hauntId: string; reason: string }[]>) | undefined,
  isSafeReason: (reason: string) => boolean,
  budgetMs = POLICY.agentBudgetMs,
): Promise<Decision & { agentUsed: boolean }> {
  const feasibleIds = [decision.pick?.hauntId, ...decision.waiting.filter((w) => w.code === "ranked_lower").map((w) => w.hauntId)].filter(
    (x): x is string => !!x,
  );
  if (!agent || feasibleIds.length < 2 || decision.mode !== "conductor") return { ...decision, agentUsed: false };
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), budgetMs));
  const ranked = await Promise.race([agent(feasibleIds).catch(() => null), timeout]);
  const top = Array.isArray(ranked) ? ranked.find((r) => r && typeof r.hauntId === "string" && feasibleIds.includes(r.hauntId)) : undefined;
  if (!top || top.hauntId === decision.pick?.hauntId) {
    if (top && decision.pick && typeof top.reason === "string" && isSafeReason(top.reason)) {
      return { ...decision, pick: { hauntId: decision.pick.hauntId, reason: top.reason }, agentUsed: true };
    }
    return { ...decision, agentUsed: false };
  }
  const waiting = decision.waiting
    .filter((w) => w.hauntId !== top.hauntId)
    .concat({ hauntId: decision.pick!.hauntId, code: "ranked_lower" as const, reason: "Good one, queued behind the pick" });
  const reason = typeof top.reason === "string" && isSafeReason(top.reason) ? top.reason : "Picked for this moment";
  return { mode: "conductor", pick: { hauntId: top.hauntId, reason }, waiting, agentUsed: true };
}
