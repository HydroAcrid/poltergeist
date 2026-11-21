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

  it("rejects blocked words hidden with invisible characters, leetspeak, spacing or look-alike letters", async () => {
    const hidden = [
      "thick fog rolls in and a g​un appears", // zero-width space
      "fog rolls in, then a k­nife drops", // soft hyphen
      "the fog hides a b‍omb in the hall", // zero-width joiner
      "fog rolls in and a ⁦gun⁩ drops", // bidi isolates
      "fog rolls in with a g u n",
      "fog rolls in with a g.u.n",
      "fog rolls in and a k1ll3r chair",
      "fog rolls in and a bl00dy chair",
      "fog rolls in and a gυn drops", // Greek upsilon
      "fog rolls in and a кnife drops", // Cyrillic ka
    ];
    for (const s of hidden) {
      const m = await mod.moderate(s);
      expect(m.safe, JSON.stringify(s)).toBe(false);
      expect(m.text).toBe("");
    }
  });

  it("never lets control, format or markup characters into approved text", async () => {
    for (const s of ["fog rolls in \u0000", "fog‮rolls in", "fog rolls​ in slowly", "fog rolls in\tslowly"]) {
      const m = await mod.moderate(s);
      if (m.safe) expect(m.text, JSON.stringify(s)).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    }
    expect((await mod.moderate("fog rolls in <b>bold</b>")).safe).toBe(false);
    expect((await mod.moderate("fog rolls​ in slowly")).text).toBe("Fog rolls in slowly");
  });

  it("does not over-block ordinary words, numbers or single letters", async () => {
    for (const s of ["fog rolls in at 3 am", "2 chairs tip over in the aisle", "a cat runs down aisle 4", "fog rolls in, a b c of shadows", "the lamps flicker 10 times"]) {
      expect((await mod.moderate(s)).safe, s).toBe(true);
    }
  });

  it("strips invisible characters from nicknames and drops hidden unsafe ones", () => {
    expect(mod.nickname("spo​oky")).toBe("spooky");
    expect(mod.nickname("k1ll3r")).toBeUndefined();
    expect(mod.nickname("g u n s")).toBeUndefined();
    expect(mod.nickname("<b>hi</b>")).toBeUndefined();
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
