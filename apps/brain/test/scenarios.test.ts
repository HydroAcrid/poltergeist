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
