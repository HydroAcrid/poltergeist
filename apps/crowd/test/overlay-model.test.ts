// /overlay logic: World's rehearsal-state adapter (provisional field names), card stage, side and staleness.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module, no type declarations
import * as M from "../web/overlay-model.js";

const NOW = 1_800_000_000_000;
const pub = (id: string, status: string, text: string, who: string) => ({ hauntId: id, status, displayName: who, moderated: { safe: true, text, tags: ["distractor"], model: "rules-only" }, votes: 0, seeded: false, createdAt: NOW });

describe("normalizeRehearsal", () => {
  it("reads phase, deadline, fear, feet, observed time and prop stages", () => {
    const w = M.normalizeRehearsal({
      round: {
        phase: "live", deadline: NOW + 36_000, fear: 1,
        trackedFeet: [740, 380], trackedAt: NOW - 500, observed: 2817,
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

  it("delivery alone never claims more than 'Taking effect'", () => {
    expect(M.pickCard(crowd("injected"), null)).toMatchObject({ stage: "sent", label: "Taking effect" });
    expect(M.pickCard(crowd("dispatched"), null)).toMatchObject({ stage: "sending" });
  });

  it("shows the reaction only once World confirms it", () => {
    expect(M.pickCard(crowd("injected"), world({ seen: 1 })).reaction).toBeUndefined();
    expect(M.pickCard(crowd("injected"), world({ reactedAt: 3, reaction: "Robot steps right around it" })).reaction).toBe("Robot steps right around it");
  });

  it("shows the conductor's public reason on the Up next card", () => {
    const q = crowd("injected").queue;
    const c = M.pickCard({ hallway: [], queue: q, upNext: { hauntId: q[0]!.hauntId, reason: "It will roll right through the flashlight beam", mode: "conductor" } }, null);
    expect(c).toMatchObject({ stage: "upnext", why: "It will roll right through the flashlight beam" });
    expect(M.pickCard({ hallway: [], queue: q, upNext: { hauntId: q[0]!.hauntId, reason: "Next in line", mode: "fifo" } }, null).why).toBeUndefined();
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

describe("World's real /rehearsal/state bodies (test/fixtures/rehearsal-*.json)", () => {
  const load = (f: string) => JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", f), "utf8"));

  it("opening: phase, countdown to the opening deadline, World's queue as Up next, big join", () => {
    const body = load("rehearsal-opening.json");
    const w = M.normalizeRehearsal(body);
    expect(w).toMatchObject({ phase: "opening", finished: false, fear: 0, serverNow: body.now, deadline: body.round.deadline, live: false });
    expect(M.phaseOf(null, w)).toBe("opening");
    expect(M.secondsLeft(null, w, body.now)).toBe(30);
    expect(M.bigJoin(M.phaseOf(null, w))).toBe(true);
    expect(M.pickCard({ hallway: [], queue: [] }, w)).toMatchObject({ stage: "upnext", text: "A gust blows loose papers across the aisle", who: "Inky Fern" });
  });

  it("playing: reactedAt 0 is 'not yet', so a placed prop is only 'Taking effect'", () => {
    const body = load("rehearsal-playing.json");
    const w = M.normalizeRehearsal(body);
    expect(M.phaseOf(null, w)).toBe("live");
    expect(w.props[0]).toMatchObject({ hauntId: "ht_01M7ZQ0D7XEXJ2KFTXE5KEMT0C", acked: 1795286944237, seen: undefined, inPath: undefined, reactedAt: undefined, reaction: undefined, text: "Paper storm", by: "Inky Fern" });
    expect(M.pickCard({ hallway: [], queue: [] }, w)).toMatchObject({ stage: "sent", label: "Taking effect", text: "Paper storm", who: "Inky Fern" });
    expect(M.cardSide(w, body.now)).toBeNull(); // no tracked feet in the fixture renderer → top-margin status
  });

  it("playing, once World sets reactedAt: shows the flinch as the reaction", () => {
    const body = load("rehearsal-playing.json");
    body.round.props[0].reactedAt = body.now - 200;
    const w = M.normalizeRehearsal(body);
    expect(M.pickCard({ hallway: [], queue: [] }, w)).toMatchObject({ stage: "reacted", reaction: "Robot flinches" });
  });

  it("native: seen but off-path stays 'Seen', the card goes opposite the robot on the right, and it's finished", () => {
    const body = load("rehearsal-native-selected.json");
    const w = M.normalizeRehearsal(body);
    expect(w.props[0]).toMatchObject({ acked: 0, seen: 0, inPath: undefined, reactedAt: undefined });
    expect(M.pickCard({ hallway: [], queue: [] }, w)).toMatchObject({ stage: "seen", label: "Seen in the hallway", who: "Lucky Specter" });
    expect(w.robotX).toBeCloseTo(0.879);
    expect(M.cardSide(w, body.trackedAt + 500)).toBe("left");
    expect(M.phaseOf(null, w)).toBe("result");
  });

  it("prefers Crowd's moderated text over World's copy when both have the haunting", () => {
    const w = M.normalizeRehearsal(load("rehearsal-playing.json"));
    const crowd = { hallway: [pub("ht_01M7ZQ0D7XEXJ2KFTXE5KEMT0C", "injected", "A gust blows loose papers across the aisle", "Inky Fern")], queue: [] };
    expect(M.pickCard(crowd, w)).toMatchObject({ text: "A gust blows loose papers across the aisle" });
  });

  it("captions World's dodge (seen in the first combined rehearsal) without counting a scare", () => {
    const body = load("rehearsal-playing.json");
    Object.assign(body.round.props[0], { reactedAt: body.now - 100, response: "dodge" });
    const w = M.normalizeRehearsal(body);
    expect(M.pickCard({ hallway: [], queue: [] }, w)).toMatchObject({ stage: "reacted", reaction: "Robot dodges it" });
    expect(w.fear).toBe(0);
  });

  it("a World prop the conductor selected but hasn't sent yet shows as Up next on the same card", () => {
    const body = load("rehearsal-playing.json");
    Object.assign(body.round.props[0], { placedAt: 0, selectedAt: body.now - 300 });
    expect(M.pickCard({ hallway: [], queue: [] }, M.normalizeRehearsal(body))).toMatchObject({ stage: "upnext", label: "Up next", text: "Paper storm" });
    Object.assign(body.round.props[0], { sentAt: body.now - 100 });
    expect(M.pickCard({ hallway: [], queue: [] }, M.normalizeRehearsal(body))).toMatchObject({ stage: "sent", label: "Taking effect" });
  });

  it("waiting room: World's lobby phases show the lobby view with the big join QR", () => {
    for (const [lp, text] of [["before-photo", "Setting up the hallway…"], ["lobby", "The waiting room is open"], ["starting", "Starting…"]]) {
      const w = M.normalizeRehearsal({ round: null, lobby: { phase: lp, openedAt: 1, ready: true, preparing: false }, now: 2 });
      expect(M.phaseOf(null, w)).toBe("lobby");
      expect(M.bigJoin("lobby")).toBe(true);
      expect(M.lobbyText(w)).toBe(text);
    }
    const ended = M.normalizeRehearsal({ round: { phase: "ended", props: [] }, lobby: { phase: "ended" }, now: 2 });
    expect(M.phaseOf(null, ended)).toBe("result");
  });

  it("result headlines", () => {
    expect(M.resultText({ winner: "robot" })).toBe("Robot escaped");
    expect(M.resultText({ winner: "audience", reason: "fear", fear: 3 })).toBe("👻 Audience wins: 3 scares");
    expect(M.resultText({ winner: "audience", reason: "timeout" })).toBe("Audience wins: time's up");
    expect(M.resultText({ reason: "stream interrupted" })).toBe("Interrupted: no winner");
  });
});

it("reports the source receipt without assuming a projector decoded a frame", () => {
  for (const [status, sceneReceipt, label] of [
    ["dispatched", "filming", "Picked for the hallway"],
    ["injected", "in-recording", "In this scene"],
    ["injected", "generated-in-path", "Seen in the robot’s path"],
  ]) {
    const h = {...pub("ht_A", status!, "Rolling bucket", "Blue Fog"), sceneReceipt};
    expect(M.pickCard({hallway:[h]}, null)).toMatchObject({label});
  }
});

it("gives a missed haunting a public outcome even when stale World evidence remains", () => {
  const row = {...pub("ht_A","failed","Fog rolls in","Blue Fog"), sceneReceipt:"filming"};
  const card = M.pickCard({hallway:[row]}, {props:[{hauntId:"ht_A", acked:120, selectedAt:100,
    reaction:"internal reviewer details", reason:"internal rendering details"}]});
  expect(card).toMatchObject({label:"Didn’t appear this round"});
  expect(JSON.stringify(card)).not.toMatch(/internal|review|render|filming/i);
});
