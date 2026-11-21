// Scoreboard + kill feed from verdicts, and scare counting on TickLog 1.1.0 `reaction`.
import { describe, expect, it } from "vitest";
import { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import type { Haunt } from "@poltergeist/contracts/haunt.js";
import type { Verdict } from "@poltergeist/contracts/verdict.js";
import { buildScoreboard, countScares } from "../server/scoreboard.js";
import type { RefTick } from "../server/referee.js";

const NOW = 1_800_000_000_000;
const ep1 = "ep_01JDPG00000000000000000001";
const ep2 = "ep_01JDPG00000000000000000002";
const haunt = (id: string, device: string, name: string, text: string, tags: NonNullable<Haunt["moderated"]>["tags"], seeded = false): Haunt => ({
  hauntId: id, deviceId: device, displayName: name, raw: "raw text " + id, status: "injected", episodeId: ep1, injectedT: 8000,
  moderated: { safe: true, text, tags, model: "rules-only" }, votes: 0, seeded, createdAt: NOW,
});
const fog = haunt("ht_01JDPG00000000000000000060", "dv_aaaaaaaaaaaaaaaa", "Cosmic Echo", "Thick fog rolls down the hallway", ["visibility", "weather"]);
const peel = haunt("ht_01JDPG00000000000000000061", "dv_bbbbbbbbbbbbbbbb", "Rainy Lamp", "A banana peel lands in the aisle", ["distractor", "geometry"]);
const seeded = haunt("ht_01JDPG00000000000000000099", "seed", "House Ghost", "The hallway lights flicker and dim", ["lighting"], true);
const verdict = (episodeId: string, extra: Partial<Verdict>): Verdict => ({ episodeId, stage: "provisional", outcome: "failure", failureT: 9000, overrodeRule: false, evidence: [], confidence: 0.5, model: "rule", createdAt: NOW, ...extra } as Verdict);

describe("buildScoreboard", () => {
  const board = buildScoreboard({
    haunts: [fog, peel, seeded],
    injected: [
      { hauntId: fog.hauntId, t: 8000, ok: true, episodeId: ep1 },
      { hauntId: peel.hauntId, t: 20000, ok: true, episodeId: ep2 },
      { hauntId: seeded.hauntId, t: 32000, ok: false, episodeId: ep2 },
    ],
    verdicts: [
      verdict(ep1, { blame: "adversary", ruleBlame: "adversary", culpritHauntId: fog.hauntId, confidence: 0.6, createdAt: NOW - 1000 }),
      verdict(ep2, { blame: "world", ruleBlame: "world", createdAt: NOW }),
    ],
    policyVersion: "v1",
    now: NOW,
  });

  it("is a valid Scoreboard", () => {
    expect(() => Scoreboard.parse(board)).not.toThrow();
  });

  it("counts attacks, landed hauntings, attackers, tags and blame", () => {
    expect(board).toMatchObject({ rounds: 2, episodes: 2, successes: 0, uniqueAttackers: 2, blame: { adversary: 1, agent: 0, world: 1 } });
    expect(board.attacks).toEqual({ submitted: 2, approved: 2, injected: 2, landed: 1 });
    expect(board.topAttackers).toEqual([{ displayName: "Cosmic Echo", landed: 1 }]);
    expect(board.topTags[0]).toEqual({ tag: "visibility", injected: 1, landed: 1 });
  });

  it("writes display-safe kill feed lines, newest first", () => {
    expect(board.killFeed.map((k) => k.text)).toEqual([
      "👻 world glitch: Genie forgot the target",
      "🛡️ Rainy Lamp: A banana peel lands in the aisle → robot shrugged it off",
      "💀 Cosmic Echo: Thick fog rolls down the hallway → robot lost the target",
    ]);
    expect(JSON.stringify(board)).not.toMatch(/raw text|dv_/);
  });
});

describe("countScares (TickLog 1.1.0 reaction)", () => {
  const tick = (t: number, reaction?: string): RefTick => ({ seq: t / 500, t, perception: { visible: true, conf: 0.9 }, action: { key: "W", holdMs: 600 }, mode: "track", ...(reaction ? { reaction } : {}) });
  const inj = [{ hauntId: "h1", t: 8000, ok: true }];
  const seen = new Map([["h1", 8500]]);

  it("scores a stumble after a seen, injected haunting, once", () => {
    expect(countScares([tick(9000, "stumble"), tick(9500, "stumble"), tick(10000, "recover")], inj, seen)).toEqual([{ hauntId: "h1", t: 9000 }]);
  });

  it("never scores avoid, recover or unclear", () => {
    expect(countScares([tick(9000, "avoid"), tick(9500, "unclear"), tick(10000, "recover")], inj, seen)).toEqual([]);
  });

  it("needs the haunting to be seen, injected ok, and the stumble within 6 s", () => {
    expect(countScares([tick(9000, "stumble")], inj, new Map())).toEqual([]);
    expect(countScares([tick(9000, "stumble")], [{ hauntId: "h1", t: 8000, ok: false }], seen)).toEqual([]);
    expect(countScares([tick(14500, "stumble")], inj, seen)).toEqual([]);
    expect(countScares([tick(8200, "stumble")], inj, seen)).toEqual([]); // before it was seen
  });
});
