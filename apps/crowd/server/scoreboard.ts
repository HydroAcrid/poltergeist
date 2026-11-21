// Scoreboard, kill feed and scare counting (apps/crowd/CLAUDE.md "Scoreboard and kill feed").
import type { HauntTag } from "@poltergeist/contracts/common.js";
import type { Haunt } from "@poltergeist/contracts/haunt.js";
import type { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import type { Verdict } from "@poltergeist/contracts/verdict.js";
import type { RefInjected, RefTick } from "./referee.js";

export interface ScoreInput {
  haunts: Haunt[]; // Crowd's own store (includes seeded); raw/deviceId never reach the output
  injected: (RefInjected & { episodeId: string })[];
  verdicts: Verdict[]; // final if present, else provisional, one per episode
  policyVersion: string;
  now: number;
}

const clip90 = (s: string) => (s.length > 90 ? s.slice(0, 89) + "…" : s);
const nameOf = (h?: Haunt) => h?.displayName || "anon";

/** Hallway rounds credit each observed scare. Other games use the referee’s culprit. */
export function landedIds(verdicts: Verdict[]): Set<string> {
  const ids = new Set<string>();
  for (const v of verdicts) {
    if (v.hallway) {
      for (const reaction of v.hallway.reactions) if (reaction.kind === "scare") ids.add(reaction.hauntId);
    } else if (v.blame === "adversary" && v.culpritHauntId) ids.add(v.culpritHauntId);
  }
  return ids;
}

export function buildScoreboard({ haunts, injected, verdicts, policyVersion, now }: ScoreInput): Scoreboard {
  const byId = new Map(haunts.map((h) => [h.hauntId, h]));
  const audience = haunts.filter((h) => !h.seeded);
  const okInjected = injected.filter((i) => i.ok);
  const landed = landedIds(verdicts);

  const attackerLanded = new Map<string, number>();
  for (const id of landed) {
    const h = byId.get(id);
    if (h && !h.seeded) attackerLanded.set(nameOf(h), (attackerLanded.get(nameOf(h)) ?? 0) + 1);
  }
  const tagStats = new Map<HauntTag, { injected: number; landed: number }>();
  for (const i of okInjected) {
    const tag = byId.get(i.hauntId)?.moderated?.tags?.[0];
    if (!tag) continue;
    const s = tagStats.get(tag) ?? { injected: 0, landed: 0 };
    s.injected++;
    if (landed.has(i.hauntId)) s.landed++;
    tagStats.set(tag, s);
  }

  // Kill feed, newest first: one line per landed or shrugged-off haunting, plus world glitches.
  const feed: { ts: number; text: string }[] = [];
  const endedEpisodes = new Set(verdicts.map((v) => v.episodeId));
  const hallwayWins = { robot: 0, audience: 0 };
  const hallwayEpisodes = new Set(verdicts.filter(v => v.hallway).map(v => v.episodeId));
  for (const v of verdicts) {
    if (v.hallway) {
      if (v.hallway.reason === "exit") hallwayWins.robot++;
      if (v.hallway.reason === "fear" || v.hallway.reason === "time") hallwayWins.audience++;
      for (const reaction of v.hallway.reactions) {
        const h = byId.get(reaction.hauntId);
        const action = reaction.kind === "scare" ? "scared the robot" : "made the robot sidestep";
        feed.push({ ts: reaction.at, text: clip90(`${nameOf(h)} ${action} · ${h?.moderated?.text ?? "a haunting"}`) });
      }
      continue;
    }
    if (v.blame === "world") feed.push({ ts: v.createdAt, text: "👻 world glitch: Genie forgot the target" });
    if (v.blame === "adversary" && v.culpritHauntId) {
      const h = byId.get(v.culpritHauntId);
      feed.push({ ts: v.createdAt, text: clip90(`💀 ${nameOf(h)}: ${h?.moderated?.text ?? "a haunting"} → robot lost the target`) });
    }
  }
  for (const i of okInjected) {
    if (hallwayEpisodes.has(i.episodeId) || landed.has(i.hauntId) || !endedEpisodes.has(i.episodeId)) continue;
    const h = byId.get(i.hauntId);
    const v = verdicts.find((x) => x.episodeId === i.episodeId);
    feed.push({ ts: v?.createdAt ?? now, text: clip90(`🛡️ ${nameOf(h)}: ${h?.moderated?.text ?? "a haunting"} → robot shrugged it off`) });
  }
  feed.sort((a, b) => b.ts - a.ts);

  return {
    updatedAt: now,
    rounds: endedEpisodes.size,
    episodes: endedEpisodes.size,
    ...(hallwayEpisodes.size ? { hallwayWins } : {}),
    successes: verdicts.filter((v) => v.outcome === "success").length,
    attacks: {
      submitted: audience.length,
      approved: audience.filter((h) => h.moderated?.safe).length,
      injected: okInjected.length,
      landed: landed.size,
    },
    uniqueAttackers: new Set(audience.map((h) => h.deviceId)).size,
    topAttackers: [...attackerLanded].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([displayName, n]) => ({ displayName: displayName.slice(0, 16), landed: n })),
    topTags: [...tagStats].sort((a, b) => b[1].landed - a[1].landed || b[1].injected - a[1].injected).map(([tag, s]) => ({ tag, ...s })),
    blame: {
      adversary: verdicts.filter((v) => v.blame === "adversary").length,
      agent: verdicts.filter((v) => v.blame === "agent").length,
      world: verdicts.filter((v) => v.blame === "world").length,
    },
    policy: { version: policyVersion || "v1" },
    killFeed: feed.slice(0, 8),
  };
}

export const SCARE_WINDOW_MS = 6000;

/**
 * Scares (TickLog 1.1.0 `reaction`): a haunting earns at most one scare, only for a `stumble`
 * observed within 6 s after it was injected (ok) and not before it was seen. `avoid`, `recover`
 * and `unclear` never score. `seenAt` maps hauntId → when it was confirmed visible.
 */
export function countScares(ticks: RefTick[], injected: RefInjected[], seenAt: Map<string, number>): { hauntId: string; t: number }[] {
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  const scares: { hauntId: string; t: number }[] = [];
  for (const inj of injected) {
    if (!inj.ok) continue;
    const seen = seenAt.get(inj.hauntId);
    if (seen === undefined) continue;
    const hit = sorted.find((k) => k.reaction === "stumble" && k.t > inj.t && k.t <= inj.t + SCARE_WINDOW_MS && k.t >= seen);
    if (hit) scares.push({ hauntId: inj.hauntId, t: hit.t });
  }
  return scares;
}
