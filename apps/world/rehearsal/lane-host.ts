// Run with Crowd's vite-node resolver until the shared hub is available.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MemoryBus } from '../../crowd/dev/memory-bus';
import { createCrowdModule } from '../../crowd/server/index';
import { newId } from '../../crowd/server/ids';
import { stepNav } from '../../brain/server/navigate';
import { initialState } from '../../brain/server/controller';
import { loadPolicy } from '../../brain/server/policy';
import { FixturePerception } from '../../brain/server/perception/fixture';
import { TickHandler } from '../../brain/server/tick';
import type { PlayerTask } from '../../brain/server/perception/player-input';
import { fromTrailView, trailInput } from './trail-view.mjs';
import { registerStage } from './server.mjs';

const requireCrowd = createRequire(
  new URL('../../crowd/package.json', import.meta.url),
);
const app = requireCrowd('fastify')();
const bus = new MemoryBus();
const crowd = createCrowdModule({
  config: { firstDispatchMs: 1200, seededFallback: false },
});
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PG_STAGE_PORT || 8914);
const tasks = new Map<string, PlayerTask>();
const ticks = new TickHandler({
  adapter: new FixturePerception(),
  policy: loadPolicy(),
  taskFor: (id) => tasks.get(id),
});
const unsubscribe = bus.subscribe(
  ['episode.started', 'episode.ended'],
  (event) => {
    const episode = event.payload as { episodeId: string; task?: PlayerTask };
    if (event.type === 'episode.started' && episode.task)
      tasks.set(episode.episodeId, episode.task);
    else if (event.type === 'episode.ended') {
      ticks.reset(episode.episodeId);
      tasks.delete(episode.episodeId);
    }
  },
);
app.post('/api/brain/tick', async (req) => ticks.handle(req.body));
const makePilot = () => {
  let state = initialState();
  const policy = loadPolicy();
  return (scene) => {
    if (!scene.visible) {
      state = initialState();
      return {
        action: { key: 'NOOP' },
        rationale: 'Robot out of view — holding still',
      };
    }
    const decision = stepNav(
      state,
      fromTrailView(scene),
      { driver: 'brain' } as any,
      policy,
    );
    state = decision.state;
    return trailInput(decision);
  };
};
await registerStage(app, {
  bus,
  root,
  newId,
  makePilot,
  crowdPhone: true,
  captureDir:
    process.env.PG_ALLOW_GENIE === '1' ? process.env.PG_CAPTURE_DIR : undefined,
  defaultPhoto: process.env.PG_VENUE_PHOTO,
  brainUrl:
    process.env.PG_BRAIN_URL || `http://127.0.0.1:${port}/api/brain/tick`,
});
await crowd.register(app, {
  bus,
  dataDir: './data-test',
  env: { ...process.env },
  instance: 'local',
  log: () => {},
});
app.addHook('onClose', async () => {
  unsubscribe();
  await crowd.close();
});
await app.listen({
  port,
  host: '127.0.0.1',
});

console.log(
  `Host      http://127.0.0.1:${port}/team\nProjector http://127.0.0.1:${port}/stage\nAudience  http://127.0.0.1:${port}/haunt`,
);
