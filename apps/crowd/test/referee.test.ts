// Referee rule against Brain's scenario bundles (pinned snapshot in test/fixtures/scenarios).
// Expected values live in test/expected/<scenario>.json, as the lane guide asks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

describe.each(["clean-success", "lost-after-haunt", "world-forgot", "agent-wander", "haunt-but-irrelevant", "never-seen"])("%s", (name) => {
  const expected = JSON.parse(readFileSync(join(__dirname, "expected", `${name}.json`), "utf8"));
  const v = ruleVerdict(load(name), NOW);

  it("matches the expected verdict", () => {
    expect(v).toMatchObject(expected);
  });

  it("is a valid provisional rule verdict", () => {
    expect(Verdict.parse(v)).toMatchObject({ stage: "provisional", model: "rule", overrodeRule: false });
    if (v.outcome === "failure") expect(v.ruleBlame).toBe(v.blame);
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
    for (const name of ["lost-after-haunt", "world-forgot", "agent-wander", "never-seen"]) {
      const v = ruleVerdict(load(name), NOW);
      expect(v.evidence.length).toBeLessThanOrEqual(5);
      for (const e of v.evidence) expect(e.note.length).toBeLessThanOrEqual(80);
    }
  });
});
