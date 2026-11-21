// Brain-owned contract fixtures: every valid/ file parses, every invalid/ file fails.
// World's packages/contracts/test/fixtures.test.ts will cover this repo-wide once it lands.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { PolicyPromoted } from "@poltergeist/contracts/policy.js";
import { ReplayEvalRequest, ReplayEvalResult, ReplayFrame } from "@poltergeist/contracts/replay.js";
import { TickLog } from "@poltergeist/contracts/tick-log.js";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";

const fixtures = resolve(__dirname, "../../../fixtures");
const schemas: Record<string, ZodTypeAny> = {
  "tick-response": TickResponse,
  "tick-log": TickLog,
  "policy-promoted": PolicyPromoted,
  "replay-frame": ReplayFrame,
  "replay-eval-request": ReplayEvalRequest,
  "replay-eval-result": ReplayEvalResult,
};
const list = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".json"));
const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe.each(Object.entries(schemas))("%s fixtures", (name, schema) => {
  const validDir = join(fixtures, name, "valid");
  const invalidDir = join(fixtures, name, "invalid");

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

it("ships every TickResponse scenario CONTRACTS §8 requires", () => {
  expect(list(join(fixtures, "tick-response/valid")).sort()).toEqual(
    ["fallback-timeout.json", "search.json", "success.json", "track.json", "unstick.json"],
  );
  expect(list(join(fixtures, "tick-log/valid"))).toEqual(expect.arrayContaining(["lost.json", "track.json"]));
});
