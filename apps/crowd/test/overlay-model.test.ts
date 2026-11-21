// /overlay logic: World's rehearsal-state adapter (provisional field names), card stage, side and staleness.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module, no type declarations
import * as M from "../web/overlay-model.js";

const NOW = 1_800_000_000_000;
const pub = (id: string, status: string, text: string, who: string) => ({ hauntId: id, status, displayName: who, moderated: { safe: true, text, tags: ["distractor"], model: "rules-only" }, votes: 0, seeded: false, createdAt: NOW });

describe("normalizeRehearsal (provisional World shape)", () => {
  it("reads phase, deadline, fear, feet, observed time and prop stages", () => {
    const w = M.normalizeRehearsal({
      round: {
        phase: "live", deadline: NOW + 36_000, fear: 1,
        trackedFeet: [740, 380], observed: { at: NOW - 500 },
        props: [{ hauntId: "ht_A", acked: true, seen: NOW - 2000, inPath: false, reactedAt: null, reaction: "Robot steps right around it" }],
      },
    });
    expect(w).toMatchObject({ phase: "live", deadline: NOW + 36_000, fear: 1, robotX: 0.38, observedAt: NOW - 500 });
    expect(w.props[0]).toMatchObject({ hauntId: "ht_A", acked: 0, seen: NOW - 2000, inPath: undefined, reactedAt: undefined });
  });

  it("uses trackedAt (Unix ms) as the vision time and ignores the integer observed frame", () => {
    const w = M.normalizeRehearsal({ round: { now: NOW, trackedAt: NOW - 400, observed: 2817, trackedFeet: [731, 612] } });
    expect(w).toMatchObject({ observedAt: NOW - 400, serverNow: NOW, robotX: 0.612 });
    expect(M.cardSide(w, NOW)).toBe("left");
  });

  it("accepts {x,y} feet in 0..1 or 0..1000 and an id field", () => {
    expect(M.normalizeRehearsal({ round: { trackedFeet: { x: 0.8, y: 0.7 } } }).robotX).toBe(0.8);
    expect(M.normalizeRehearsal({ round: { trackedFeet: { x: 620, y: 700 } } }).robotX).toBe(0.62);
    expect(M.normalizeRehearsal({ round: { props: [{ id: "ht_B", acked: NOW }] } }).props[0].hauntId).toBe("ht_B");
  });

  it("returns null for junk and survives missing fields", () => {
    expect(M.normalizeRehearsal(null)).toBeNull();
    expect(M.normalizeRehearsal("nope")).toBeNull();
    expect(M.normalizeRehearsal({ round: {} })).toMatchObject({ props: [] });
  });
});

describe("card side", () => {
  it("goes opposite the robot while its position is fresh", () => {
    expect(M.cardSide({ robotX: 0.3, observedAt: NOW - 1000 }, NOW)).toBe("right");
    expect(M.cardSide({ robotX: 0.75, observedAt: NOW - 1000 }, NOW)).toBe("left");
  });

  it("falls back to the top margin (null) when the observation is stale or missing", () => {
    expect(M.cardSide({ robotX: 0.3, observedAt: NOW - M.STALE_MS - 1 }, NOW)).toBeNull();
    expect(M.cardSide({ robotX: 0.3 }, NOW)).toBeNull();
    expect(M.cardSide(null, NOW)).toBeNull();
  });
});

describe("pickCard keeps the four World stages distinct", () => {
  const crowd = (status: string) => ({ hallway: [pub("ht_A", status, "A banana peel lands in the aisle", "Cosmic Echo")], queue: [pub("ht_Q", "queued", "Thick fog rolls down the hallway", "Rainy Lamp")] });
  const world = (p: object) => ({ props: [{ hauntId: "ht_A", ...p }] });

  it.each([
    [{}, "sent"],
    [{ acked: 0 }, "sent"],
    [{ acked: 0, seen: 1 }, "seen"],
    [{ acked: 0, seen: 1, inPath: 2 }, "inPath"],
    [{ acked: 0, seen: 1, inPath: 2, reactedAt: 3 }, "reacted"],
  ])("World prop %o → %s", (p, stage) => {
    expect(M.pickCard(crowd("injected"), world(p))).toMatchObject({ stage, text: "A banana peel lands in the aisle", who: "Cosmic Echo" });
  });

  it("delivery alone never claims more than 'Sent to the hallway'", () => {
    expect(M.pickCard(crowd("injected"), null)).toMatchObject({ stage: "sent", label: "Sent to the hallway" });
    expect(M.pickCard(crowd("dispatched"), null)).toMatchObject({ stage: "sending" });
  });

  it("shows the reaction only once World confirms it", () => {
    expect(M.pickCard(crowd("injected"), world({ seen: 1 })).reaction).toBeUndefined();
    expect(M.pickCard(crowd("injected"), world({ reactedAt: 3, reaction: "Robot steps right around it" })).reaction).toBe("Robot steps right around it");
  });

  it("falls back to Up next when nothing has been sent", () => {
    expect(M.pickCard({ hallway: [], queue: crowd("injected").queue }, null)).toMatchObject({ stage: "upnext", who: "Rainy Lamp" });
    expect(M.pickCard({ hallway: [], queue: [] }, null)).toBeNull();
  });

  it("takes display text only from Crowd's moderated state, never from World's payload", () => {
    const c = M.pickCard(crowd("injected"), { props: [{ hauntId: "ht_A", seen: 1, text: "RAW <CELEB_NAME>", raw: "x" }] });
    expect(JSON.stringify(c)).not.toMatch(/RAW|CELEB/);
  });
});

describe("phase, clock and join", () => {
  it("maps World phases and falls back to Crowd", () => {
    expect(M.phaseOf({}, { phase: "opening" })).toBe("opening");
    expect(M.phaseOf({}, { phase: "playing" })).toBe("live");
    expect(M.phaseOf({}, { phase: "result" })).toBe("result");
    expect(M.phaseOf({ episodeActive: true }, null)).toBe("live");
    expect(M.phaseOf({ episodeActive: false }, null)).toBe("idle");
  });

  it("counts down to World's deadline, else Crowd's round end", () => {
    expect(M.secondsLeft({ roundEndsAt: NOW + 10_000 }, { deadline: NOW + 36_000 }, NOW)).toBe(36);
    expect(M.secondsLeft({ roundEndsAt: NOW + 10_000 }, null, NOW)).toBe(10);
    expect(M.clock(36)).toBe("0:36");
  });

  it("shows the big QR only in the opening, the result or between rounds", () => {
    expect(M.bigJoin("opening")).toBe(true);
    expect(M.bigJoin("result")).toBe(true);
    expect(M.bigJoin("live")).toBe(false);
  });
});
