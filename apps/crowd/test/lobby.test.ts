// Pregame waiting room (World assigned to Crowd on #2): count real guest phones only, never the
// projector; the phone follows World's lobby phase instead of an invented countdown.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState } from "@poltergeist/contracts/haunt.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

async function guest(asPhone = true) {
  const first = await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: asPhone ? { "x-pg-client": "phone" } : {} });
  const cookie = String(first.headers["set-cookie"]).split(";")[0]!;
  const poll = async () =>
    CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie, ...(asPhone ? { "x-pg-client": "phone" } : {}) } })).json());
  return { cookie, poll };
}
const lobby = async () => (await hub.app.inject({ method: "GET", url: "/api/crowd/lobby" })).json();

describe("joined count", () => {
  it("counts each guest phone once, however often it polls", async () => {
    const a = await guest();
    const b = await guest();
    await a.poll();
    await a.poll();
    await b.poll();
    expect(await lobby()).toEqual({ here: 2, total: 2 });
    expect((await a.poll()).joined).toBe(2);
  });

  it("never counts the projector or other non-phone polls", async () => {
    await guest();
    const projector = await guest(false);
    await projector.poll();
    await hub.app.inject({ method: "GET", url: "/api/crowd/lobby" });
    expect(await lobby()).toEqual({ here: 1, total: 1 });
  });

  it("'here' drops phones that stopped polling for 30 s; 'total' remembers everyone who joined", async () => {
    const a = await guest();
    await guest();
    hub.clock.advance(31_000);
    await a.poll();
    expect(await lobby()).toEqual({ here: 1, total: 2 });
  });

  it("a guest who joins late is counted right away and can send an idea", async () => {
    hub.world.startEpisode();
    const late = await guest();
    expect((await late.poll()).joined).toBe(1);
    const res = await hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie: late.cookie }, payload: { preset: "fog" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("phone page follows World's phase", () => {
  it("asks World for the lobby phase, marks its polls as a phone, and has no invented countdown", async () => {
    const page = (await hub.app.inject({ method: "GET", url: "/haunt" })).body;
    expect(page).toContain("/rehearsal/lobby");
    expect(page).toContain('"x-pg-client": "phone"');
    expect(page).not.toContain("Next round in");
    expect(page).toContain('id="lobby"');
  });
});
