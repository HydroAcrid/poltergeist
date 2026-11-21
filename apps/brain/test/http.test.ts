// POST /api/brain/tick over Fastify inject (no network), fixture perception.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TickLog } from "@poltergeist/contracts/tick-log.js";
import { TickResponse } from "@poltergeist/contracts/tick-response.js";
import { buildServer } from "../server/http.js";
import { FixturePerception, WORLD_FLASHLIGHT, WORLD_HALLWAY } from "../server/perception/fixture.js";
import { loadPolicy } from "../server/policy.js";
import { TickHandler } from "../server/tick.js";
import { EP, req } from "./helpers.js";

const task = { targetLabel: "exit", instruction: "Walk to the exit at the far end of the hallway." };
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "brain-http-"));
  dirs.push(dataDir);
  const policy = loadPolicy("v1");
  const handler = new TickHandler({ adapter: new FixturePerception(), policy, taskFor: () => task });
  const app = buildServer({ handler, dataDir, policy: { version: "v1", yaml: "version: v1" }, perception: "fixture" });
  return { app, dataDir };
}

const chairAhead = () => readFileSync(join(WORLD_FLASHLIGHT, "chair-ahead.jpg")).toString("base64");

describe("POST /api/brain/tick", () => {
  it("answers a valid TickRequest with a valid TickResponse", async () => {
    const { app } = setup();
    const r = await app.inject({ method: "POST", url: "/api/brain/tick", payload: req(0, chairAhead()) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(TickResponse.safeParse(body).success).toBe(true);
    expect([body.episodeId, body.seq, body.action.key]).toEqual([EP, 0, "D"]);
  });

  it("after responding, writes the frame and appends a valid TickLog", async () => {
    const { app, dataDir } = setup();
    await app.inject({ method: "POST", url: "/api/brain/tick", payload: req(3, chairAhead()) });
    await new Promise((r) => setTimeout(r, 20));
    const dir = join(dataDir, "episodes", EP);
    expect(existsSync(join(dir, "frames", "3.jpg"))).toBe(true);
    const lines = readFileSync(join(dir, "ticks.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const log = TickLog.parse(JSON.parse(lines[0]!));
    expect(log.framePath).toBe(`data/episodes/${EP}/frames/3.jpg`);
    expect(log.rationale).toBe("obstacle ahead, stepping right");
    expect(log.reaction).toBe("avoid");
  });

  it("records the observed reaction in the TickLog (not in the TickResponse)", async () => {
    const { app, dataDir } = setup();
    const stumbling = readFileSync(join(WORLD_HALLWAY, "stumbling.jpg")).toString("base64");
    const r = await app.inject({ method: "POST", url: "/api/brain/tick", payload: req(0, stumbling) });
    expect(r.json().reaction).toBeUndefined();
    await new Promise((res) => setTimeout(res, 20));
    const log = TickLog.parse(JSON.parse(readFileSync(join(dataDir, "episodes", EP, "ticks.jsonl"), "utf8").trim()));
    expect(log.reaction).toBe("stumble");
  });

  it("rejects an invalid request with 400 and the shared error shape", async () => {
    const { app } = setup();
    const oversized = await app.inject({ method: "POST", url: "/api/brain/tick", payload: req(0, "A".repeat(80_004)) });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().error.code).toBe("INVALID");
    expect(oversized.json().error.message).toMatch(/frame\.b64/);
    const garbage = await app.inject({ method: "POST", url: "/api/brain/tick", payload: { hello: "world" } });
    expect(garbage.statusCode).toBe(400);
  });

  it("serves health and the active policy", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/brain/health" })).json()).toEqual({ ok: true, perception: "fixture", policyVersion: "v1" });
    expect((await app.inject({ url: "/api/brain/policy" })).json()).toEqual({ version: "v1", yaml: "version: v1" });
  });
});
