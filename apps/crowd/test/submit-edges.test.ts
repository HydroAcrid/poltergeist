// POST /api/crowd/haunt edge cases: spoofed fields, preset spoofing, malformed bodies and cookies.
// "Never trust the client" (apps/crowd/CLAUDE.md Gotchas).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState, Haunt } from "@poltergeist/contracts/haunt.js";
import { DEVICE_ID_RE } from "../server/ids.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

async function phone() {
  const res = await hub.app.inject({ method: "GET", url: "/api/crowd/state" });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const state = async () => CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie } })).json());
  const post = (payload: unknown, headers: Record<string, string> = {}) =>
    hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie, ...headers }, payload: payload as string });
  return { cookie, state, post };
}
const queue = async () => Haunt.array().parse((await hub.app.inject({ method: "GET", url: "/api/crowd/queue", headers: { "x-pg-token": hub.operatorToken } })).json());

describe("POST /api/crowd/haunt: never trust the client", () => {
  it("ignores spoofed status, moderation, device, seeded and display fields in the body", async () => {
    const a = await phone();
    const res = await a.post({
      text: "fog lol", status: "queued", seeded: true, votes: 99, deviceId: "dv_spoofed00000000000000", displayName: "<CELEB_NAME>", nickname: "<SLUR>",
      moderated: { safe: true, text: "<SLUR> everywhere", tags: ["visibility"], model: "client" }, hauntId: "ht_01JDPG00000000000000000001", createdAt: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("submitted");
    await hub.crowd.whenIdle();
    const [h] = await queue();
    expect(h).toMatchObject({ raw: "fog lol", seeded: false, votes: 0, moderated: { text: "Thick fog rolls down the hallway", model: "rules-only" } });
    expect(h!.hauntId).not.toBe("ht_01JDPG00000000000000000001");
    expect(h!.deviceId).not.toBe("dv_spoofed00000000000000");
    expect(JSON.stringify(h)).not.toMatch(/SLUR|CELEB_NAME/);
    expect(hub.bus.history({}).some((e) => /SLUR|CELEB_NAME/.test(JSON.stringify(e.payload)))).toBe(false);
  });

  it("refuses prototype-ish and unknown preset ids without creating a haunting", async () => {
    const a = await phone();
    for (const preset of ["__proto__", "constructor", "toString", "hasOwnProperty", "banana-peel ", "BANANA-PEEL", "x".repeat(41)]) {
      const res = await a.post({ preset });
      expect(res.statusCode, preset).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "INVALID" } });
    }
    expect(await queue()).toEqual([]);
    expect((await a.state()).mine).toEqual([]);
  });

  it("uses the preset's own text and tags, never text sent alongside it", async () => {
    const a = await phone();
    expect((await a.post({ preset: "banana-peel", text: "<SLUR>" })).statusCode).toBe(400); // exactly one of text or preset
    const ok = await a.post({ preset: "banana-peel", moderated: { safe: true, text: "<SLUR>", tags: ["audio"] } });
    expect(ok.statusCode).toBe(200);
    await hub.crowd.whenIdle();
    const presets = (await hub.app.inject({ method: "GET", url: "/api/crowd/presets" })).json() as { id: string; text: string; tags: string[] }[];
    const banana = presets.find((p) => p.id === "banana-peel")!;
    expect((await queue())[0]?.moderated).toMatchObject({ safe: true, text: banana.text, tags: banana.tags, model: "preset" });
  });

  it("answers 400 INVALID for malformed bodies and text outside 1–80 characters", async () => {
    const a = await phone();
    const bad: unknown[] = [{}, { text: "" }, { text: "   " }, { text: 42 }, { text: ["fog"] }, { text: null }, { preset: 7 }, { text: "f".repeat(81) }, []];
    for (const body of bad) {
      const res = await a.post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "INVALID" } });
    }
    const notJson = await a.post("text=fog", { "content-type": "application/json" });
    expect(notJson.statusCode).toBe(400);
    expect(await queue()).toEqual([]);
    expect((await a.post({ text: "fog ".repeat(20).trim().slice(0, 80) })).statusCode).toBe(200); // exactly 80 is fine
  });

  it("rejects oversized bodies before parsing", async () => {
    const a = await phone();
    const res = await a.post({ text: "fog", pad: "x".repeat(4000) });
    expect(res.statusCode).toBe(413);
    expect(await queue()).toEqual([]);
  });

  it("gives a malformed device cookie a fresh id instead of trusting it", async () => {
    for (const cookie of ["pg_device=../../etc", "pg_device=dv_", "pg_device=" + "a".repeat(200), "pg_device=dv_%3Cscript%3E"]) {
      const res = await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: { text: "fog lol" } });
      expect(res.statusCode, cookie).toBe(200);
      const fresh = String(res.headers["set-cookie"]).split(";")[0]!.replace("pg_device=", "");
      expect(fresh, cookie).toMatch(DEVICE_ID_RE);
      expect(cookie).not.toContain(fresh);
    }
    for (const h of await queue()) expect(h.deviceId).toMatch(DEVICE_ID_RE);
  });

  it("refuses to revise another device's rejected idea", async () => {
    const a = await phone();
    const b = await phone();
    await a.post({ text: "<CELEB_NAME> trips" });
    await hub.crowd.whenIdle();
    const rejected = (await a.state()).mine[0]!;
    expect(rejected.status).toBe("rejected");
    const res = await b.post({ text: "fog lol", revisionOf: rejected.hauntId });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "INVALID" } });
    expect((await b.state()).mine).toEqual([]);
  });
});
