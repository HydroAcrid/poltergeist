// Brain-owned scenario bundles (fixtures/scenarios/*): every file validates
// line by line, and the two "seen in the hallway" bundles give the result
// Crowd's interim rule expects.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Episode, EpisodeEnded } from "@poltergeist/contracts/episode.js";
import { HauntInjected } from "@poltergeist/contracts/haunt-injected.js";
import { TickLog } from "@poltergeist/contracts/tick-log.js";

const scenarios = resolve(__dirname, "../../../fixtures/scenarios");
const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const load = (name: string) => {
  const dir = join(scenarios, name);
  return {
    episode: Episode.parse(JSON.parse(readFileSync(join(dir, "episode.json"), "utf8"))),
    ended: EpisodeEnded.parse(JSON.parse(readFileSync(join(dir, "ended.json"), "utf8"))),
    ticks: lines(join(dir, "ticks.jsonl")).map((l) => TickLog.parse(l)),
    injected: lines(join(dir, "injected.jsonl")).map((l) => HauntInjected.parse(l)),
    haunts: lines(join(dir, "haunts.jsonl")),
  };
};

/** Crowd's interim rule (#2): first tick after an ok injection whose hazards gain a label. */
function seenAt(ticks: TickLog[], injectedT: number): TickLog | undefined {
  const before = new Set(ticks.filter((t) => t.t <= injectedT).flatMap((t) => t.perception.hazards.map((h) => h.label)));
  return ticks.find((t) => t.t > injectedT && t.perception.hazards.some((h) => !before.has(h.label)));
}

const names = readdirSync(scenarios).filter((d) => existsSync(join(scenarios, d, "episode.json")));

describe.each(names)("scenario %s", (name) => {
  it("has every file CONTRACTS §8 lists, and each validates", () => {
    for (const f of ["episode.json", "ended.json", "ticks.jsonl", "injected.jsonl", "haunts.jsonl", "README.md"]) {
      expect(existsSync(join(scenarios, name, f)), f).toBe(true);
    }
    expect(() => load(name)).not.toThrow();
  });

  it("is internally consistent", () => {
    const s = load(name);
    const ids = new Set([s.episode.episodeId, s.ended.episodeId, ...s.ticks.map((t) => t.episodeId), ...s.injected.map((i) => i.episodeId), ...s.haunts.map((h) => h.episodeId)]);
    expect(ids.size).toBe(1);
    expect(s.ticks.map((t) => t.seq)).toEqual(s.ticks.map((_, i) => i));
    expect(s.ticks.every((t, i) => i === 0 || t.t > s.ticks[i - 1]!.t)).toBe(true);
    expect(s.ticks.at(-1)!.t).toBeLessThanOrEqual(s.ended.durationMs);
    for (const i of s.injected) expect(s.haunts.find((h) => h.hauntId === i.hauntId)?.injectedT).toBe(i.t);
    // No raw phone text anywhere a player or the stage could read it.
    const raw = s.haunts.map((h) => h.raw as string);
    for (const t of s.ticks) for (const r of raw) expect(JSON.stringify(t)).not.toContain(r);
  });
});

describe("Crowd's 'In the hallway' rule on Brain's bundles", () => {
  it("hazard-after-haunt: confirmed 1.5 s after injection, with a display-safe response", () => {
    const s = load("hazard-after-haunt");
    const inj = s.injected[0]!;
    const seen = seenAt(s.ticks, inj.t)!;
    expect(seen).toBeDefined();
    expect([seen.seq, seen.t]).toEqual([19, 9500]);
    expect(seen.t - inj.t).toBeLessThanOrEqual(2000);
    expect(seen.rationale).toBe("obstacle ahead, turning toward exit");
    expect(seen.rationale.length).toBeLessThanOrEqual(60);
  });

  it("no-hazard-after-haunt: nothing new for at least 6 s, so it stays 'Sent to world'", () => {
    const s = load("no-hazard-after-haunt");
    const inj = s.injected[0]!;
    expect(seenAt(s.ticks, inj.t)).toBeUndefined();
    expect(s.ticks.at(-1)!.t - inj.t).toBeGreaterThanOrEqual(6000);
  });

  it("the single tick-log fixtures are the deciding ticks from the bundles", () => {
    const fx = (f: string) => TickLog.parse(JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/tick-log/valid", f), "utf8")));
    expect(fx("hazard-after-haunt.json")).toEqual(load("hazard-after-haunt").ticks[19]);
    expect(fx("no-hazard-after-haunt.json")).toEqual(load("no-hazard-after-haunt").ticks.at(-1));
  });
});

describe("referee bundles say what their READMEs claim", () => {
  const visibleAt = (s: ReturnType<typeof load>, seq: number) => s.ticks[seq]!.perception.visible;
  const lastVisible = (s: ReturnType<typeof load>) => s.ticks.reduce((acc, t) => (t.perception.visible ? t.seq : acc), -1);

  it("clean-success: no haunts, two successClaims in a row at the end, ended by success_claim", () => {
    const s = load("clean-success");
    expect(s.injected).toHaveLength(0);
    expect(s.ticks.every((t) => t.perception.visible)).toBe(true);
    expect(s.ticks.slice(-2).every((t) => t.successClaim)).toBe(true);
    expect(s.ticks.slice(0, -2).some((t) => t.successClaim)).toBe(false);
    expect(s.ended.reason).toBe("success_claim");
  });

  it("lost-after-haunt: visible until a visibility haunting, then never again", () => {
    const s = load("lost-after-haunt");
    const inj = s.injected[0]!;
    expect(s.haunts[0]!.moderated.tags).toContain("visibility");
    expect(s.ticks.filter((t) => t.t <= inj.t).every((t) => t.perception.visible)).toBe(true);
    const lost = s.ticks.find((t) => !t.perception.visible)!;
    expect(lost.t - inj.t).toBeGreaterThan(0);
    expect(lost.t - inj.t).toBeLessThanOrEqual(2000);
    expect(lastVisible(s)).toBeLessThan(lost.seq);
    expect(s.ended.reason).toBe("timeout");
  });

  it("world-forgot: conf ≥ 0.8 at seq 14 after NOOP, gone at seq 15 forever, no haunt within 8 s", () => {
    const s = load("world-forgot");
    const [a, b] = [s.ticks[14]!, s.ticks[15]!];
    expect(a.perception.visible && a.perception.conf >= 0.8).toBe(true);
    expect(a.action.key).toBe("NOOP");
    expect(visibleAt(s, 15)).toBe(false);
    expect(lastVisible(s)).toBe(14);
    expect(s.injected.filter((i) => b.t - i.t <= 8000 && i.t <= b.t)).toHaveLength(0);
  });

  it("agent-wander: no haunts; turns away from a target on its right, then loses it", () => {
    const s = load("agent-wander");
    expect(s.injected).toHaveLength(0);
    for (const t of s.ticks.slice(6, 10)) {
      expect(t.perception.point![1]).toBeGreaterThan(500);
      expect(t.action.key).toBe("ArrowLeft");
    }
    expect(lastVisible(s)).toBe(9);
  });

  it("haunt-but-irrelevant: same wander, plus an audio-only haunting 0.5 s before the loss", () => {
    const s = load("haunt-but-irrelevant");
    const w = load("agent-wander");
    expect(s.ticks.map((t) => [t.perception.visible, t.action.key])).toEqual(w.ticks.map((t) => [t.perception.visible, t.action.key]));
    expect(s.haunts.map((h) => h.moderated.tags)).toEqual([["audio"]]);
    expect(s.ticks.find((t) => !t.perception.visible && t.seq > 0)!.t - s.injected[0]!.t).toBe(500);
  });

  it("never-seen: the target is never visible", () => {
    const s = load("never-seen");
    expect(s.injected).toHaveLength(0);
    expect(s.ticks.some((t) => t.perception.visible)).toBe(false);
  });
});
