// Referee rule against Brain's scenario bundles (pinned snapshot in test/fixtures/scenarios).
// Expected values live in test/expected/<scenario>.json, as the lane guide asks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HauntTag } from "@poltergeist/contracts/common.js";
import { Verdict } from "@poltergeist/contracts/verdict.js";
import { failureTime, ruleVerdict, type RefereeInput } from "../server/referee.js";

const dir = join(__dirname, "fixtures/scenarios");
const lines = (p: string) => readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
function load(name: string): RefereeInput {
  const d = join(dir, name);
  return {
    episode: JSON.parse(readFileSync(join(d, "episode.json"), "utf8")),
    ended: JSON.parse(readFileSync(join(d, "ended.json"), "utf8")),
    ticks: lines(join(d, "ticks.jsonl")),
    injected: lines(join(d, "injected.jsonl")),
    haunts: lines(join(d, "haunts.jsonl")),
  };
}
const NOW = 1_800_000_000_000;

describe.each([
  "clean-success",
  "lost-after-haunt",
  "world-forgot",
  "agent-wander",
  "haunt-but-irrelevant",
  "never-seen",
  "hazard-after-haunt",
  "no-hazard-after-haunt",
])("%s", (name) => {
  const expected = JSON.parse(readFileSync(join(__dirname, "expected", `${name}.json`), "utf8"));
  const v = ruleVerdict(load(name), NOW);

  it("matches the expected verdict", () => {
    expect(v).toMatchObject(expected);
  });

  it("is a valid provisional rule verdict", () => {
    expect(Verdict.parse(v)).toMatchObject({ stage: "provisional", model: "rule", overrodeRule: false });
    if (v.outcome === "failure") expect(v.ruleBlame).toBe(v.blame);
    if (v.blame !== "adversary") expect(v.culpritHauntId).toBeUndefined();
  });
});

describe("rule details", () => {
  it("world-forgot must come out as world (lane guide)", () => {
    expect(ruleVerdict(load("world-forgot"), NOW).blame).toBe("world");
  });

  it("uses the lane guide's confidences", () => {
    expect(ruleVerdict(load("clean-success"), NOW).confidence).toBe(0.8);
    expect(ruleVerdict(load("lost-after-haunt"), NOW).confidence).toBe(0.6);
    expect(ruleVerdict(load("world-forgot"), NOW).confidence).toBe(0.5);
    expect(ruleVerdict(load("agent-wander"), NOW).confidence).toBe(0.5);
  });

  it("aborts short operator stops, errors and watchdogs; long ones are failures", () => {
    const base = load("agent-wander");
    expect(ruleVerdict({ ...base, ended: { ...base.ended, reason: "operator_stop", durationMs: 6000 } }, NOW).outcome).toBe("aborted");
    expect(ruleVerdict({ ...base, ended: { ...base.ended, reason: "watchdog", durationMs: 9999 } }, NOW).outcome).toBe("aborted");
    expect(ruleVerdict({ ...base, ended: { ...base.ended, reason: "error", durationMs: 15000 } }, NOW).outcome).toBe("failure");
  });

  it("ignores failed injections and hauntings outside [failureT − 8 s, failureT + 1 s]", () => {
    const base = load("lost-after-haunt");
    const failed = { ...base, injected: base.injected.map((i) => ({ ...i, ok: false })) };
    expect(ruleVerdict(failed, NOW).blame).not.toBe("adversary");
    const tooEarly = { ...base, injected: base.injected.map((i) => ({ ...i, t: 9000 - 8001 })) };
    expect(ruleVerdict(tooEarly, NOW).blame).not.toBe("adversary");
    const justAfter = { ...base, injected: base.injected.map((i) => ({ ...i, t: 9000 + 1000 })) };
    expect(ruleVerdict(justAfter, NOW).blame).toBe("adversary");
  });

  it("failureT: never visible → 0; visible to the end → last tick", () => {
    expect(failureTime(load("never-seen").ticks)).toBe(0);
    const seenToEnd = load("clean-success").ticks;
    expect(failureTime(seenToEnd)).toBe(seenToEnd.at(-1)!.t);
  });

  it("evidence notes stay within the contract limits", () => {
    for (const name of [
      "lost-after-haunt",
      "world-forgot",
      "agent-wander",
      "never-seen",
      "hazard-after-haunt",
      "no-hazard-after-haunt",
    ]) {
      const v = ruleVerdict(load(name), NOW);
      expect(v.evidence.length).toBeLessThanOrEqual(5);
      for (const e of v.evidence) expect(e.note.length).toBeLessThanOrEqual(80);
    }
  });
});

// Synthetic edge cases (no Brain bundle needed).
describe("rule edge cases (synthetic ticks)", () => {
  const EP = "ep_01JDPG00000000000000000099";
  type T = RefereeInput["ticks"][number];
  const tk = (seq: number, visible: boolean, o: Partial<Omit<T, "perception">> & { conf?: number } = {}): T => ({
    seq, t: seq * 500, perception: { visible, conf: o.conf ?? (visible ? 0.9 : 0.1) }, action: o.action ?? { key: "W", holdMs: 600 }, mode: o.mode ?? (visible ? "track" : "search"),
  });
  /** Visible for seq 0..lostAt-1 (last one customisable), lost from lostAt to 29. */
  const ticks = (lostAt: number, last: Partial<Omit<T, "perception">> & { conf?: number } = {}) =>
    Array.from({ length: 30 }, (_, s) => (s < lostAt ? tk(s, true, s === lostAt - 1 ? last : {}) : tk(s, false)));
  const input = (o: Partial<RefereeInput>): RefereeInput => ({
    episode: { episodeId: EP }, ended: { episodeId: EP, reason: "timeout", durationMs: 15000 }, ticks: ticks(18), injected: [], haunts: [], ...o,
  });
  const haunt = (id: string, tags: HauntTag[]) => ({ hauntId: id, moderated: { tags, text: `text of ${id}` } });

  it("picks the latest visual haunting in the window as the culprit", () => {
    const v = ruleVerdict(input({
      injected: [{ hauntId: "ht_a", t: 3000, ok: true }, { hauntId: "ht_b", t: 7000, ok: true }, { hauntId: "ht_c", t: 8500, ok: true }],
      haunts: [haunt("ht_a", ["visibility"]), haunt("ht_b", ["lighting"]), haunt("ht_c", ["occlusion"])],
    }), NOW);
    expect(v).toMatchObject({ blame: "adversary", culpritHauntId: "ht_c", failureT: 9000 });
  });

  it("skips a later non-visual (audio) haunting and blames the earlier visual one", () => {
    const v = ruleVerdict(input({
      injected: [{ hauntId: "ht_fog", t: 5000, ok: true }, { hauntId: "ht_alarm", t: 8500, ok: true }],
      haunts: [haunt("ht_fog", ["visibility"]), haunt("ht_alarm", ["audio"])],
    }), NOW);
    expect(v).toMatchObject({ blame: "adversary", culpritHauntId: "ht_fog" });
  });

  it("never blames an audio/other-only haunting, or one with no known record", () => {
    const audio = ruleVerdict(input({ injected: [{ hauntId: "ht_alarm", t: 8500, ok: true }], haunts: [haunt("ht_alarm", ["audio", "other"])] }), NOW);
    expect(audio.blame).not.toBe("adversary");
    const unknown = ruleVerdict(input({ injected: [{ hauntId: "ht_ghost", t: 8500, ok: true }] }), NOW);
    expect(unknown.blame).not.toBe("adversary");
    expect(unknown.culpritHauntId).toBeUndefined();
  });

  it("sorts ticks by seq, so out-of-order delivery gives the same verdict", () => {
    const inOrder = input({ ticks: ticks(18, { action: { key: "NOOP", holdMs: 0 } }) });
    const shuffled = { ...inOrder, ticks: [...inOrder.ticks].reverse() };
    expect(ruleVerdict(shuffled, NOW)).toEqual(ruleVerdict(inOrder, NOW));
    expect(ruleVerdict(shuffled, NOW)).toMatchObject({ blame: "world", failureT: 9000 });
  });

  it("counts search/unstick ticks as lost even while the target is visible", () => {
    const t = ticks(18).map((k) => (k.seq >= 14 && k.seq < 18 ? { ...k, mode: k.seq % 2 ? "unstick" : "search" } : k));
    expect(failureTime(t)).toBe(7000);
  });

  it("world vs agent: small-action and confidence boundaries on the tick before L", () => {
    const blame = (last: Partial<Omit<T, "perception">> & { conf?: number }) => ruleVerdict(input({ ticks: ticks(18, last) }), NOW).blame;
    expect(blame({ action: { key: "NOOP", holdMs: 0 } })).toBe("world");
    expect(blame({ action: { key: "ArrowLeft", holdMs: 150 } })).toBe("world");
    expect(blame({ action: { key: "ArrowRight", holdMs: 151 } })).toBe("agent");
    expect(blame({ action: { key: "W", holdMs: 400 } })).toBe("world");
    expect(blame({ action: { key: "S", holdMs: 401 } })).toBe("agent");
    expect(blame({ action: { key: "NOOP", holdMs: 0 }, conf: 0.7 })).toBe("world");
    expect(blame({ action: { key: "NOOP", holdMs: 0 }, conf: 0.69 })).toBe("agent");
  });

  it("a failure with no ticks at all is the agent's, at failureT 0", () => {
    const v = ruleVerdict(input({ ticks: [] }), NOW);
    expect(v).toMatchObject({ outcome: "failure", blame: "agent", failureT: 0 });
    expect(Verdict.parse(v).evidence[0]?.note).toBe("Target never visible this round");
  });

  it("aborts only under 10 s: exactly 10 000 ms is a failure", () => {
    expect(ruleVerdict(input({ ended: { episodeId: EP, reason: "operator_stop", durationMs: 10000 } }), NOW).outcome).toBe("failure");
    expect(ruleVerdict(input({ ended: { episodeId: EP, reason: "timeout", durationMs: 3000 } }), NOW).outcome).toBe("failure");
  });

  it("clips long haunting text in evidence to 80 characters and stays a valid Verdict", () => {
    const v = ruleVerdict(input({
      injected: [{ hauntId: "ht_01JDPG00000000000000000099", t: 8000, ok: true }],
      haunts: [{ hauntId: "ht_01JDPG00000000000000000099", moderated: { tags: ["visibility"], text: "x".repeat(120) } }],
    }), NOW);
    expect(v.evidence[0]!.note.length).toBeLessThanOrEqual(80);
    Verdict.parse(v);
  });

  it("blames agent with no culprit on timeout when target stayed visible, even right after a visual haunting", () => {
    const visibleToEnd = Array.from({ length: 20 }, (_, s) => tk(s, true)); // last tick at t = 9500
    const v = ruleVerdict(input({
      ticks: visibleToEnd,
      injected: [{ hauntId: "ht_01JDPG00000000000000000077", t: 9000, ok: true }],
      haunts: [haunt("ht_01JDPG00000000000000000077", ["visibility", "occlusion"])],
    }), NOW);
    expect(v).toMatchObject({ outcome: "failure", blame: "agent", ruleBlame: "agent", failureT: 9500 });
    expect(v.culpritHauntId).toBeUndefined();
    Verdict.parse(v);
  });
});

describe("TickLog.decision evidence notes at failureT", () => {
  const EP = "ep_01JDPG00000000000000000098";
  type T = RefereeInput["ticks"][number];
  const tk = (seq: number, visible: boolean, extra: Partial<T> = {}): T => ({
    seq,
    t: seq * 500,
    perception: { visible, conf: visible ? 0.9 : 0.1 },
    action: { key: "W", holdMs: 600 },
    mode: visible ? "track" : "search",
    ...extra,
  });

  it("notes when the player model chose to hold, without changing blame", () => {
    const visibleToEnd = Array.from({ length: 20 }, (_, s) =>
      tk(s, true, s === 19 ? { action: { key: "NOOP", holdMs: 0 }, decision: { source: "model", intent: "hold" } } : {}),
    );
    const v = ruleVerdict({
      episode: { episodeId: EP },
      ended: { episodeId: EP, reason: "timeout", durationMs: 10000 },
      ticks: visibleToEnd,
      injected: [],
      haunts: [],
    }, NOW);
    expect(v).toMatchObject({ outcome: "failure", blame: "agent", failureT: 9500 });
    expect(v.evidence).toContainEqual({ t: 9500, note: "Brain chose to hold" });
    Verdict.parse(v);
  });

  it("notes when geometry held because multiple robots were in view, keeping world blame unchanged", () => {
    const ticks = Array.from({ length: 20 }, (_, s) => {
      if (s < 14) return tk(s, true);
      if (s === 14) return tk(s, true, { action: { key: "NOOP", holdMs: 0 } });
      return tk(s, true, {
        action: { key: "NOOP", holdMs: 0 },
        mode: "search",
        rationale: "2 robots visible, holding",
        decision: { source: "geometry", intent: "hold" },
      });
    });
    const v = ruleVerdict({
      episode: { episodeId: EP },
      ended: { episodeId: EP, reason: "timeout", durationMs: 10000 },
      ticks,
      injected: [],
      haunts: [],
    }, NOW);
    expect(v).toMatchObject({ outcome: "failure", blame: "world", failureT: 7500 });
    expect(v.evidence).toContainEqual({ t: 7500, note: "Brain held: more than one robot in view" });
    Verdict.parse(v);
  });

  it("omits any extra decision note for a geometry hold mid-stumble", () => {
    const ticks = Array.from({ length: 20 }, (_, s) => {
      if (s < 15) return tk(s, true);
      return tk(s, true, {
        action: { key: "NOOP", holdMs: 0 },
        mode: "unstick",
        rationale: "stumbled, waiting to recover",
        ...(s === 15 ? { reaction: "stumble" } : {}),
        decision: { source: "geometry", intent: "hold" },
      });
    });
    const v = ruleVerdict({
      episode: { episodeId: EP },
      ended: { episodeId: EP, reason: "timeout", durationMs: 10000 },
      ticks,
      injected: [],
      haunts: [],
    }, NOW);
    expect(v.evidence.map((e) => e.note)).not.toContain("Brain chose to hold");
    expect(v.evidence.map((e) => e.note)).not.toContain("Brain held: more than one robot in view");
    Verdict.parse(v);
  });

  it("notes when geometry vetoed a step into a solid obstacle", () => {
    const visibleToEnd = Array.from({ length: 20 }, (_, s) =>
      tk(s, true, s === 19 ? { reaction: "avoid", decision: { source: "veto", intent: "step_right", blocked: true } } : {}),
    );
    const v = ruleVerdict({
      episode: { episodeId: EP },
      ended: { episodeId: EP, reason: "timeout", durationMs: 10000 },
      ticks: visibleToEnd,
      injected: [],
      haunts: [],
    }, NOW);
    expect(v).toMatchObject({ outcome: "failure", blame: "agent", failureT: 9500 });
    expect(v.evidence).toContainEqual({ t: 9500, note: "Brain avoided a solid obstacle" });
    Verdict.parse(v);
  });

  it("adds no decision note when decision is absent (rules mode)", () => {
    const v = ruleVerdict(load("agent-wander"), NOW);
    expect(v.evidence).toHaveLength(1);
  });
});
