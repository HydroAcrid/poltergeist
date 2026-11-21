// POST /api/crowd/operator: token-guarded, Crowd-scoped OperatorCommands onto the bus (C14).
// The /operator page UI is not built yet (layout and copy go to Courtney first).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrowdState } from "@poltergeist/contracts/haunt.js";
import { OperatorCommand } from "@poltergeist/contracts/operator.js";
import { buildTestHub, type TestHub } from "./hub.js";

let hub: TestHub;
beforeEach(async () => {
  hub = await buildTestHub();
});
afterEach(async () => {
  await hub.close();
});

const send = (payload: unknown, token: string | null = hub.operatorToken) =>
  hub.app.inject({ method: "POST", url: "/api/crowd/operator", headers: token === null ? {} : { "x-pg-token": token }, payload: payload as object });
const commands = () => hub.bus.history({ types: ["operator.command"] });

async function phone() {
  const res = await hub.app.inject({ method: "GET", url: "/api/crowd/state" });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const state = async () => CrowdState.parse((await hub.app.inject({ method: "GET", url: "/api/crowd/state", headers: { cookie } })).json());
  const submit = (body: Record<string, unknown>) => hub.app.inject({ method: "POST", url: "/api/crowd/haunt", headers: { cookie }, payload: body });
  return { state, submit };
}

describe("POST /api/crowd/operator", () => {
  it("answers 401 without the operator token or with a wrong one, and publishes nothing", async () => {
    for (const token of [null, "", "wrong-token"]) {
      const res = await send({ cmd: "finals.approvalMode", on: true }, token);
      expect(res.statusCode, String(token)).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    }
    expect(commands()).toHaveLength(0);
  });

  it("answers 400 INVALID for bodies that are not an OperatorCommand", async () => {
    for (const body of [{}, { cmd: "haunt.approve" }, { cmd: "haunt.releaseSeeded", count: 0 }, { cmd: "finals.approvalMode", on: true, extra: 1 }, { cmd: "nope" }]) {
      const res = await send(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "INVALID" } });
    }
    expect(commands()).toHaveLength(0);
  });

  it("answers 400 for valid commands that are not Crowd's (round, replay, mode, dares, policy, coach)", async () => {
    const notCrowd: OperatorCommand[] = [
      { cmd: "round.stop", episodeId: "ep_01JDPG00000000000000000001" },
      { cmd: "replay.start", sourceEpisodeId: "ep_01JDPG00000000000000000001" },
      { cmd: "mode.set", mode: "genie" },
      { cmd: "haunt.dareDone", hauntId: "ht_01JDPG00000000000000000001" },
      { cmd: "policy.pin", version: "v1" },
      { cmd: "coach.run" },
    ];
    for (const body of notCrowd) {
      OperatorCommand.parse(body); // they are valid commands, just not Crowd-scoped
      const res = await send(body);
      expect(res.statusCode, body.cmd).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "INVALID" } });
    }
    expect(commands()).toHaveLength(0);
  });

  it("publishes a Crowd-scoped command on the bus as operator.command and returns it", async () => {
    const res = await send({ cmd: "haunt.releaseSeeded", count: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, command: { cmd: "haunt.releaseSeeded", count: 2 } });
    const [e] = commands();
    expect(e).toMatchObject({ type: "operator.command", source: "operator", payload: { cmd: "haunt.releaseSeeded", count: 2 } });
    OperatorCommand.parse(e!.payload);
  });

  it("drives finals approval mode, approve and reject end to end", async () => {
    const a = await phone();
    const b = await phone(); // one waiting idea per ghost, so two phones
    expect((await send({ cmd: "finals.approvalMode", on: true })).statusCode).toBe(200);
    await a.submit({ text: "fog lol" });
    await b.submit({ text: "rain starts falling" });
    await hub.crowd.whenIdle();
    const fog = (await a.state()).mine[0]!;
    const rain = (await b.state()).mine[0]!;
    expect([fog.status, rain.status]).toEqual(["approved", "approved"]);

    expect((await send({ cmd: "haunt.approve", hauntId: fog.hauntId })).statusCode).toBe(200);
    expect((await send({ cmd: "haunt.reject", hauntId: rain.hauntId })).statusCode).toBe(200);
    expect((await a.state()).mine[0]?.status).toBe("queued");
    expect((await b.state()).mine[0]?.status).toBe("rejected");
    expect(commands().map((e) => (e.payload as OperatorCommand).cmd)).toEqual(["finals.approvalMode", "haunt.approve", "haunt.reject"]);
  });
});
