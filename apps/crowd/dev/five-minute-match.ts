// Private process for the 300-phone rehearsal. World uses a deterministic clock and
// acknowledges dispatches. No renderer or provider is configured.
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { MemoryBus } from './memory-bus';
import { FakeWorld } from './fake-world';
import { createCrowdModule } from '../server/index';
import { sceneFromRehearsal } from '../server/scene';
import type { MatchClock } from '../server/crowd';

const app: FastifyInstance = createRequire(import.meta.url)('fastify')();
const bus = new MemoryBus(Date.now);
const world = new FakeWorld(bus, Date.now);
const durationMs = 300_000;
const cutEveryMs = 90_000;
const holdMs = 6_000;
let id: string | undefined,
  startedAt = 0,
  ended = false;

function clock() {
  if (!id) return undefined;
  const wallElapsed = Date.now() - startedAt;
  let activeMs = wallElapsed;
  let chapter = 1;
  for (let boundary = cutEveryMs; boundary < durationMs; boundary += cutEveryMs) {
    const wallCut = boundary + (chapter - 1) * holdMs;
    if (wallElapsed < wallCut) break;
    activeMs -= Math.min(holdMs, wallElapsed - wallCut);
    if (wallElapsed < wallCut + holdMs) {
      return {
        id,
        phase: 'handoff' as const,
        durationMs,
        remainingMs: durationMs - activeMs,
        deadline: 0,
        activeMs,
        chapter,
      };
    }
    chapter++;
  }
  const remainingMs = Math.max(0, durationMs - activeMs);
  return {
    id,
    phase: 'playing' as const,
    durationMs,
    remainingMs,
    deadline: Date.now() + remainingMs,
    activeMs: Math.min(activeMs, durationMs),
    chapter,
  };
}

const crowd = createCrowdModule({
  config: { firstDispatchMs: 1200, roundEveryMs: null, seededFallback: false },
  lobbyPhase: () => (ended ? 'ended' : id ? 'playing' : 'lobby'),
  matchClock: (): MatchClock | undefined => (ended ? undefined : clock()),
  // The fixture maintains a clear walking lane and an open camera. Injection receipts
  // alone are never reported as a visible prop or reaction.
  scene: () => {
    const c = clock();
    if (!c || ended) return undefined;
    return sceneFromRehearsal(
      { phase: c.phase, deadline: c.deadline, depth: 0.3, lane: 0, props: [] },
      Date.now(),
    );
  },
});
await crowd.register(app, {
  bus,
  env: { PG_MODERATION_ADAPTER: 'rules-only' },
  instance: 'local',
  dataDir: './data-test',
  log: () => {},
});
app.post('/rehearsal/reset-photo', async () => ({ ok: true }));
app.post<{ Body: { mode?: string } }>('/rehearsal/start', async (req, reply) => {
  if (id || req.body?.mode !== 'offline')
    return reply.code(409).send({ error: 'Only one fixture match may start' });
  startedAt = Date.now();
  id = world.startEpisode({ maxDurationMs: durationMs });
  return { id };
});
const ticker = setInterval(() => {
  void world.flush();
  if (id && !ended && clock()?.remainingMs === 0) {
    ended = true;
    world.endEpisode('timeout');
  }
}, 200);
app.get('/rehearsal/state', async () => {
  const c = clock();
  const dispatches = bus
    .history({ types: ['haunt.dispatch'] })
    .map((e) => e.payload as { hauntId: string; episodeId: string });
  return {
    canLive: false,
    round: c ? { ...c, phase: ended ? 'ended' : c.phase, live: false, props: [], dispatches } : null,
    episodeStarts: bus.history({ types: ['episode.started'] }).length,
    episodeEnds: bus.history({ types: ['episode.ended'] }).length,
  };
});
app.addHook('onClose', async () => {
  clearInterval(ticker);
  await crowd.close?.();
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.PG_STAGE_PORT) });
console.log('Private Crowd rehearsal ready');
