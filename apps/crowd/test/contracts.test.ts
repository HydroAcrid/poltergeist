// Crowd-owned contract fixtures: every valid/ file parses, every invalid/ file fails.
// World's packages/contracts/test/fixtures.test.ts will cover this repo-wide once it lands.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { Haunt, HauntDispatch, HauntPublic, Preset } from "@poltergeist/contracts/haunt.js";
import { OperatorCommand } from "@poltergeist/contracts/operator.js";
import { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import { Verdict } from "@poltergeist/contracts/verdict.js";

import { fixturesDir, ModerationCase } from "./helpers.js";
const schemas: Record<string, ZodTypeAny> = {
  haunt: Haunt,
  "haunt-public": HauntPublic,
  "haunt-dispatch": HauntDispatch,
  verdict: Verdict,
  scoreboard: Scoreboard,
  "operator-command": OperatorCommand,
};
const list = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe.each(Object.entries(schemas))("%s fixtures", (name, schema) => {
  const validDir = join(fixturesDir, name, "valid");
  const invalidDir = join(fixturesDir, name, "invalid");

  it("has at least one valid and two invalid fixtures", () => {
    expect(list(validDir).length).toBeGreaterThanOrEqual(1);
    expect(list(invalidDir).length).toBeGreaterThanOrEqual(2);
  });

  it.each(list(validDir))("valid/%s parses", (file) => {
    const r = schema.safeParse(load(join(validDir, file)));
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it.each(list(invalidDir))("invalid/%s is rejected", (file) => {
    expect(schema.safeParse(load(join(invalidDir, file))).success).toBe(false);
  });
});

it("ships every crowd scenario CONTRACTS §8 requires", () => {
  const has = (dir: string, names: string[]) => expect(list(join(fixturesDir, dir, "valid"))).toEqual(expect.arrayContaining(names.map((n) => `${n}.json`)));
  has("haunt", ["submitted", "rejected-unsafe", "approved-fog", "injected"]);
  has("verdict", ["provisional-adversary", "final-world-override", "success", "aborted"]);
  has("scoreboard", ["empty", "midday"]);
  const cmds = list(join(fixturesDir, "operator-command/valid")).map((f) => load(join(fixturesDir, "operator-command/valid", f)).cmd);
  expect(new Set(cmds)).toEqual(new Set(OperatorCommand.options.map((o) => o.shape.cmd.value)));
});

describe("presets.json", () => {
  const presets = z.array(Preset).parse(load(join(fixturesDir, "haunt/presets.json")));
  it("has 8–10 unique presets led by the banana peel", () => {
    expect(presets.length).toBeGreaterThanOrEqual(8);
    expect(presets.length).toBeLessThanOrEqual(10);
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    expect(presets[0]?.id).toBe("banana-peel");
    // Every preset has a group heading for the "More ideas" page; the first three (shown on
    // the main screen) come from three different groups.
    expect(presets.every((p) => p.group)).toBe(true);
    expect(new Set(presets.slice(0, 3).map((p) => p.group)).size).toBe(3);
  });
});

describe("seeded-pool.json", () => {
  const pool = z.array(Haunt).parse(load(join(fixturesDir, "haunt/seeded-pool.json")));
  it("has 12 pre-approved, seeded haunts with unique ids", () => {
    expect(pool).toHaveLength(12);
    expect(new Set(pool.map((h) => h.hauntId)).size).toBe(12);
    for (const h of pool) {
      expect(h.seeded).toBe(true);
      expect(h.status).toBe("approved");
      expect(h.moderated?.safe).toBe(true);
    }
  });
});

describe("moderation-cases.json", () => {
  const cases = z.array(ModerationCase).parse(load(join(fixturesDir, "haunt/moderation-cases.json")));
  it("has 30 cases, at least 10 adversarial, using placeholder tokens only", () => {
    expect(cases).toHaveLength(30);
    expect(cases.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      if (c.expectSafe) expect(c.expectTags.length).toBeGreaterThanOrEqual(1);
      if (c.adversarial) expect(c.expectSafe).toBe(false);
    }
  });
});
