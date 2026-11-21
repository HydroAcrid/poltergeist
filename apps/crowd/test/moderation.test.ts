// rules-only moderation against fixtures/haunt/moderation-cases.json (free, no model calls).
// The hydrogen adapter's accuracy test is @live and humans run it (PG_LIVE=1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Moderated, Preset } from "@poltergeist/contracts/haunt.js";
import { RulesOnlyModeration } from "../server/moderation/rules.js";
import { fixturesDir, ModerationCase } from "./helpers.js";

const cases = z.array(ModerationCase).parse(JSON.parse(readFileSync(join(fixturesDir, "haunt/moderation-cases.json"), "utf8")));
const presets = z.array(Preset).parse(JSON.parse(readFileSync(join(fixturesDir, "haunt/presets.json"), "utf8")));
const mod = new RulesOnlyModeration();

describe("rules-only moderation", () => {
  it("never approves a case expected to be unsafe (zero false approvals)", async () => {
    for (const c of cases.filter((x) => !x.expectSafe)) {
      const m = await mod.moderate(c.input);
      expect(m.safe, `${c.id} "${c.input}" should be rejected`).toBe(false);
      expect(m.text).toBe("");
      expect(m.reason?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("approves at least 90% of the safe cases, with valid text and overlapping tags", async () => {
    const safe = cases.filter((x) => x.expectSafe);
    let approved = 0;
    for (const c of safe) {
      const m = Moderated.parse(await mod.moderate(c.input));
      if (!m.safe) continue;
      approved++;
      expect(m.text.length).toBeLessThanOrEqual(60);
      expect(m.tags.length).toBeGreaterThanOrEqual(1);
      expect(m.tags.length).toBeLessThanOrEqual(3);
      expect(m.tags.some((t) => c.expectTags.includes(t)), `${c.id} tags ${m.tags} vs ${c.expectTags}`).toBe(true);
    }
    expect(approved / safe.length).toBeGreaterThanOrEqual(0.9);
  });

  it("rewrites the spec example 'fog lol' into a scene event", async () => {
    const m = await mod.moderate("fog lol");
    expect(m).toMatchObject({ safe: true, text: "Thick fog rolls down the hallway", model: "rules-only" });
  });

  it("approves every preset's text as written", async () => {
    for (const p of presets) {
      const m = await mod.moderate(p.text);
      expect(m.safe, p.id).toBe(true);
    }
  });

  it("rejects over-length input without crashing", async () => {
    const m = await mod.moderate("fog ".repeat(30));
    expect(m.safe).toBe(false);
  });

  it("keeps clean nicknames and drops unsafe ones", () => {
    expect(mod.nickname("spooky sam")).toBe("spooky sam");
    expect(mod.nickname("  ghost  ")).toBe("ghost");
    expect(mod.nickname("<SLUR>")).toBeUndefined();
    expect(mod.nickname("@someone")).toBeUndefined();
    expect(mod.nickname("gun guy")).toBeUndefined();
    expect(mod.nickname("")).toBeUndefined();
  });
});
