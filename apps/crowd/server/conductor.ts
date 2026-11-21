import type { HauntTag } from "@poltergeist/contracts/common.js";

export type EffectKind = "floor_prop" | "airborne" | "lighting" | "visibility" | "sign" | "audio" | "overhead" | "other";

/** Camera and route evidence supplied by World. */
export interface SceneObservation {
  t: number; // ms since episode start
  observedAt: number; // epoch ms
  robotProgress?: number; // 0 = start of the aisle, 1 = signed exit threshold
  timeRemainingMs: number;
  cameraStable: boolean;
  obstacles: { label: string; kind: EffectKind; inBeam: boolean; progress?: number }[];
  producible: EffectKind[]; // effect kinds World can render and the camera can show right now
  verifiedPathHauntIds?: string[]; // live camera confirmed these proposals occupied the walking path
  seenHauntIds: string[]; // hauntings World has visual evidence for
}

export const EFFECT_FAMILIES = ["wind", "fog", "lighting", "balloons", "direction", "slip", "rolling", "barrier", "creature", "sound", "water", "other"] as const;
export interface Staging {
  family: typeof EFFECT_FAMILIES[number];
  impact: "subtle" | "clear" | "striking";
  placement: "ambient" | "route" | "scene_wide";
}

export interface Candidate {
  hauntId: string;
  createdAt: number;
  text: string; // moderated, display-safe
  tags: HauntTag[];
  preset?: string;
  staging?: Staging; // assessed in the same request as moderation
  skips: number; // times it was eligible but not picked
  authorPicksThisRound: number; // fair airtime: picks already given to this idea's author this round
}

export interface RecentHaunt {
  hauntId: string;
  kind: EffectKind;
  primaryTag: HauntTag;
  family?: string;
  sentAt: number; // epoch ms
  seen: boolean;
}

export type WaitCode = "too_late" | "not_in_shot" | "redundant" | "landing" | "no_view" | "similar";

export interface Decision {
  mode: "conductor" | "fifo";
  pick?: { hauntId: string; reason: string };
  waiting: { hauntId: string; code: WaitCode | "ranked_lower"; reason: string }[];
}

export const POLICY = {
  sceneMaxAgeMs: 3_000, // after this, use only checked ideas and dispatch history
  minTimeLeftMs: 10_000, // nothing new in the last 10 s
  latestProgress: { floor_prop: 0.7, airborne: 0.8, lighting: 0.85, visibility: 0.85, sign: 0.85, audio: 0.9, overhead: 0.7, other: 0.8 } as Record<EffectKind, number>,
  roomyProgress: 0.55, // props land ≥ several strides ahead with room to react
  landingWindowMs: 12_000, // wait for the last trick to be seen before stacking a same-kind one
  repeatWindowMs: 24_000, // give the audience a beat before replaying an uncontested effect
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

type Idea = Pick<Candidate, "preset" | "tags" | "text" | "staging">;
const wind = /\b(?:breezes?|drafts?|gusts?|hurricanes?|cyclones?|tornad(?:o|oes)|whirlwinds?|vort(?:ex|ices)|wind(?:s|y|storms?)?)\b(?![- ]?up\b)/i;
const windborne = /\b(?:papers?|leaves|confetti)\b/i;

export function kindOf(c: Idea): EffectKind {
  if (c.preset && PRESET_KIND[c.preset]) return PRESET_KIND[c.preset]!;
  if (/ceiling|chandelier|overhead|roof|from above/i.test(c.text) && !c.tags.includes("lighting")) return "overhead";
  if (/balloons?/i.test(c.text) || wind.test(c.text) || windborne.test(c.text)) return "airborne";
  if (c.tags.includes("lighting")) return "lighting";
  if (c.tags.includes("visibility")) return "visibility";
  if (c.tags.includes("sign_change")) return "sign";
  if (c.tags.includes("geometry") || c.tags.includes("distractor")) return "floor_prop";
  if (c.tags.includes("audio")) return "audio";
  if (c.tags.includes("weather") && /rain|snow|hail|drizzle/i.test(c.text)) return "visibility";
  return "other";
}

// Presets and rules-only ideas use the very same comparison vocabulary as checked model output.
export function familyOf(c: Idea, kind = kindOf(c)): string {
  if (c.staging && c.staging.family !== "other") return c.staging.family;
  const text = c.text;
  if (/balloon/i.test(text)) return "balloons";
  if (wind.test(text) || (kind === "airborne" && windborne.test(text))) return "wind";
  if (/peel|marbles?|slip|ice patch|slick/i.test(text)) return "slip";
  if (/puddles?|flood|rain|water|waves?/i.test(text)) return "water";
  if (/\b(?:penguins?|animals?|birds?|cats?|dogs?|mice|raccoons?)\b/i.test(text)) return "creature";
  if (/bounc|roll(?:s|ing)?|wheel/i.test(text)) return "rolling";
  if (kind === "visibility") return "fog";
  if (kind === "lighting") return "lighting";
  if (kind === "sign") return "direction";
  if (kind === "audio") return "sound";
  if (kind === "floor_prop" && /chairs?|crates?|benches?|buckets?|boxes|barrier/i.test(text)) return "barrier";
  // Unknown inventions stay distinct. Capitalization and punctuation cannot create a new idea.
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function visualScore(c: Candidate, kind: EffectKind): number {
  if (c.staging) {
    const impact = { subtle: 0, clear: 2, striking: 3 }[c.staging.impact];
    return impact + (c.staging.placement === "route" ? 1 : 0);
  }
  if (kind === "audio" || /\b(?:breeze|faint|barely|gentle|nudges?|rustle|whisper)\b/i.test(c.text)) return 0;
  if (kind === "airborne" && wind.test(c.text) && !windborne.test(c.text) && !/spiral|swirl|vortex/i.test(c.text)) return 0;
  return 2;
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

  const last = recent.at(-1);
  const fifoIndex = new Map(ordered.map((c, index) => [c.hauntId, index]));
  const similar = (id: string): Decision["waiting"][number] => ({
    hauntId: id, code: "similar", reason: "A similar haunting just had a turn",
  });
  const holdRepeat = (family: string, hasAlternative: boolean) =>
    last?.family === family && (hasAlternative || now - last.sentAt < POLICY.repeatWindowMs);

  // Dispatch history and checked intent stay available when the camera falls silent.
  if (!scene || now - scene.observedAt > POLICY.sceneMaxAgeMs) {
    const families = ordered.map(c => familyOf(c));
    // A ceiling event specifically needs a shot that World confirms can show it.
    const needsView = ordered.map(c => kindOf(c) === "overhead");
    const hasAlternative = families.some((family, i) => !needsView[i] && family !== last?.family);
    const eligible = ordered.map((c, i) => ({c, i})).filter(({i}) =>
      !needsView[i] && !holdRepeat(families[i]!, hasAlternative));
    const assessed = eligible.some(({c}) => c.staging !== undefined);
    if (assessed) {
      // Moderation already assessed the supplied action. A lost camera observation cannot
      // confirm placement, but it doesn't erase what the guest actually requested.
      eligible.sort((a, b) => Number(b.c.skips >= POLICY.priorityAfterSkips) - Number(a.c.skips >= POLICY.priorityAfterSkips)
        || visualScore(b.c, kindOf(b.c)) - visualScore(a.c, kindOf(a.c)) || fifo(a.c, b.c));
    }
    const first = eligible[0]?.i;
    const reason = assessed ? "Picked for its visible effect" : "Next in line";
    return {
      mode: assessed ? "conductor" : "fifo",
      ...(first !== undefined ? {pick: {hauntId: ordered[first]!.hauntId, reason}} : {}),
      waiting: ordered.flatMap((c, i): Decision["waiting"] => {
        if (i === first) return [];
        if (needsView[i]) return [{hauntId: c.hauntId, code: "no_view", reason: "Waiting for a view of the ceiling"}];
        if (holdRepeat(families[i]!, hasAlternative)) return [similar(c.hauntId)];
        return [{hauntId: c.hauntId, code: "ranked_lower", reason: "In line"}];
      }),
    };
  }

  if (!scene.cameraStable) {
    return { mode: "conductor", waiting: ordered.map((c) => ({ hauntId: c.hauntId, code: "no_view", reason: "Waiting for a clear view" })) };
  }

  const waiting: Decision["waiting"] = [];
  const feasible: { c: Candidate; family: string; score: number; why: string; priority: boolean }[] = [];

  const recentFour = recent.slice(-4);
  const turnsByFamily = new Map<string, number>();
  for (const r of recent) {
    if (r.family) turnsByFamily.set(r.family, (turnsByFamily.get(r.family) ?? 0) + 1);
  }

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
    const family = familyOf(c, kind);
    const novel = !recentFour.some(r => r.family ? r.family === family : r.primaryTag === c.tags[0]);
    const roomy = kind === "lighting" || kind === "visibility" || (scene.robotProgress !== undefined && scene.robotProgress <= POLICY.roomyProgress);
    const starving = now - c.createdAt >= POLICY.starveAfterMs;
    const fresh = c.authorPicksThisRound === 0; // fair airtime
    const impact = visualScore(c, kind);
    const repeatPenalty = 2 * Math.min(3, turnsByFamily.get(family) ?? 0);
    const score = impact + (novel ? 4 : 0) + (roomy ? 1 : 0) + (fresh ? 1 : 0) + (starving ? 1 : 0) - repeatPenalty;
    const priority = c.skips >= POLICY.priorityAfterSkips;
    let why = REASON[kind];
    if (kind === "floor_prop" && scene.robotProgress === undefined) why = "A floor obstacle fits this shot";
    if (kind === "airborne" && impact === 0) why = "A quieter effect fits this moment";
    if (c.staging?.placement === "route" && c.staging.impact === "striking") why = "A bold obstacle for the robot to confront";
    feasible.push({ c, family, score, why, priority });
  }

  const hasAlternative = feasible.some(item => item.family !== last?.family);
  const diverse = feasible.filter(item => {
    if (!holdRepeat(item.family, hasAlternative)) return true;
    waiting.push(similar(item.c.hauntId));
    return false;
  });
  // Skipped guests retain priority among the effects that can play this turn.
  diverse.sort((a, b) => Number(b.priority) - Number(a.priority) || b.score - a.score || fifo(a.c, b.c));
  const [best, ...others] = diverse;
  for (const o of others) waiting.push({ hauntId: o.c.hauntId, code: "ranked_lower", reason: "Good one, queued behind the pick" });
  waiting.sort((a, b) => fifoIndex.get(a.hauntId)! - fifoIndex.get(b.hauntId)!);
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
