// Fake crowd (CONTRACTS §8): seeded dispatches at t ≥ 8 s then every 12 s; on episode.ended a
// provisional verdict and a scoreboard update. Every envelope validates on the MemoryBus.
import Fastify from "fastify";
import { expect, it } from "vitest";
import { HauntDispatch } from "@poltergeist/contracts/haunt.js";
import { Scoreboard } from "@poltergeist/contracts/scoreboard.js";
import { Verdict } from "@poltergeist/contracts/verdict.js";
import { FakeWorld } from "../dev/fake-world.js";
import { MemoryBus } from "../dev/memory-bus.js";
import type { CrowdService } from "../server/crowd.js";
import { createFakeCrowdModule } from "../server/fake.js";

it("dispatches seeded haunts on schedule, then publishes a verdict and scoreboard on episode end", async () => {
  let t = 1_800_000_000_000;
  const now = () => t;
  const bus = new MemoryBus(now);
  const world = new FakeWorld(bus, now);
  const app = Fastify();
  let service!: CrowdService;
  const mod = createFakeCrowdModule({ now, autoTick: false, onService: (s) => (service = s) });
  await mod.register(app, { bus, dataDir: "./data-test", env: {}, instance: "local", log: () => {} });

  // The fake mounts the real phone routes; audience ideas are accepted but never dispatched.
  expect((await app.inject({ method: "POST", url: "/api/crowd/haunt", payload: { text: "fog lol" } })).statusCode).toBe(200);
  await service.whenIdle();

  world.startEpisode();
  const dispatchedAt: number[] = [];
  for (let s = 0; s <= 32; s++) {
    const before = bus.history({ types: ["haunt.dispatch"] }).length;
    service.tick();
    if (bus.history({ types: ["haunt.dispatch"] }).length > before) dispatchedAt.push(s * 1000);
    t += 1000;
  }
  expect(dispatchedAt).toEqual([8000, 20000, 32000]);
  const sent = bus.history({ types: ["haunt.dispatch"] }).map((e) => HauntDispatch.parse(e.payload));
  const audience = service.allHaunts().find((h) => !h.seeded)!;
  expect(sent.map((d) => d.hauntId)).not.toContain(audience.hauntId); // seeded only
  expect(audience.status).toBe("queued");
  expect(service.allHaunts().filter((h) => h.status === "dispatched").every((h) => h.seeded)).toBe(true);

  world.endEpisode("timeout");
  const verdicts = bus.history({ types: ["verdict.provisional"] });
  expect(verdicts).toHaveLength(1);
  expect(Verdict.parse(verdicts[0]!.payload)).toMatchObject({ outcome: "failure", blame: "agent", model: "rule" });
  const boards = bus.history({ types: ["scoreboard.updated"] });
  expect(Scoreboard.parse(boards[0]!.payload).blame.agent).toBe(1);

  await mod.close?.();
  await app.close();
});
