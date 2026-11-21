// Test hub: Fastify + in-memory bus + crowd's fake World + the real crowd module, on a manual clock.
import Fastify, { type FastifyInstance } from "fastify";
import { FakeWorld } from "../dev/fake-world.js";
import { MemoryBus } from "../dev/memory-bus.js";
import type { SceneObservation } from "../server/conductor.js";
import type { CrowdConfig, CrowdService } from "../server/crowd.js";
import { createCrowdModule } from "../server/index.js";

export interface TestHub {
  app: FastifyInstance;
  bus: MemoryBus;
  world: FakeWorld;
  crowd: CrowdService;
  clock: { now: () => number; advance: (ms: number) => void };
  operatorToken: string;
  dispatched: () => unknown[];
  close: () => Promise<void>;
}

export async function buildTestHub(opts: { scene?: () => SceneObservation | undefined; config?: Partial<CrowdConfig> } = {}): Promise<TestHub> {
  let t = new Date("2026-11-21T14:00:00").getTime();
  const clock = { now: () => t, advance: (ms: number) => void (t += ms) };
  const bus = new MemoryBus(clock.now);
  const world = new FakeWorld(bus, clock.now);
  const app = Fastify();
  const operatorToken = "test-operator-token";
  let crowd!: CrowdService;
  const mod = createCrowdModule({ now: clock.now, autoTick: false, scene: opts.scene, config: opts.config, onService: (s) => (crowd = s) });
  await mod.register(app, {
    bus,
    dataDir: "./data-test",
    env: { PG_OPERATOR_TOKEN: operatorToken },
    instance: "local",
    log: () => {},
  });
  await app.ready();
  return {
    app,
    bus,
    world,
    crowd,
    clock,
    operatorToken,
    dispatched: () => bus.history({ types: ["haunt.dispatch"] }).map((e) => e.payload),
    close: async () => {
      await mod.close?.();
      await app.close();
    },
  };
}
