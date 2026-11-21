// System-assigned ghost names (World's request on #2): no client nicknames, a stable curated name
// per device, distinct within the room, shown as "You are …", never exposing device ids.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState } from "@poltergeist/contracts/haunt.js";
import { GhostNames } from "../server/ghost-names.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

async function join(cookie?: string) {
  const res = await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: cookie ? { cookie } : {} });
  const jar = cookie ?? String(res.headers["set-cookie"]).split(";")[0]!;
  return { cookie: jar, state: CrowdState.parse(res.json()) };
}

describe("assigned ghost names", () => {
  it("gives two phones distinct, display-safe names as soon as they join", async () => {
    const a = await join();
    const b = await join();
    expect(a.state.you?.ghostName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(b.state.you?.ghostName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(a.state.you?.ghostName).not.toBe(b.state.you?.ghostName);
  });

  it("keeps the same name across reloads on the same device", async () => {
    const a = await join();
    const again = await join(a.cookie);
    expect(again.state.you?.ghostName).toBe(a.state.you?.ghostName);
  });

  it("ignores a forged displayName on text and preset submissions", async () => {
    const a = await join();
    const name = a.state.you!.ghostName;
    const post = (payload: object) => hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: a.cookie }, payload });
    expect((await post({ text: "fog lol", displayName: "Kevin" })).statusCode).toBe(200);
    hub.clock.advance(20_000);
    expect((await post({ preset: "banana-peel", displayName: "<CELEB_NAME>" })).statusCode).toBe(200);
    await hub.crowd.whenIdle();
    const { state } = await join(a.cookie);
    expect(state.queue.map((h) => h.displayName)).toEqual([name, name]);
    expect(JSON.stringify(state)).not.toMatch(/Kevin|CELEB_NAME/);
  });

  it("never exposes device ids in phone state or on the bus", async () => {
    const a = await join();
    const deviceId = a.cookie.replace("pg_device=", "");
    await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: a.cookie }, payload: { text: "fog lol" } });
    await hub.crowd.whenIdle();
    const { state } = await join(a.cookie);
    expect(JSON.stringify(state)).not.toContain(deviceId);
    expect(JSON.stringify(hub.bus.history({}))).not.toContain(deviceId);
  });
});

describe("GhostNames", () => {
  it("keeps 500 people in one room distinct, every name ≤ 16 characters", () => {
    const names = new GhostNames();
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = names.nameFor(`dv_device${String(i).padStart(13, "0")}`);
      expect(n.length).toBeLessThanOrEqual(16);
      seen.add(n);
    }
    expect(seen.size).toBe(500);
  });

  it("derives the name from the device id, so a restart gives the same name", () => {
    expect(new GhostNames().nameFor("dv_abcdefghijklmnop")).toBe(new GhostNames().nameFor("dv_abcdefghijklmnop"));
  });

  it("every word in the vocabulary is display-safe", () => {
    for (const w of GhostNames.vocabulary()) expect(w).toMatch(/^[A-Z][a-z]{2,8}$/);
  });
});
