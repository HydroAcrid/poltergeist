const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

async function liveStage(t) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000_000 });
  const { registerStage } = await import('../apps/world/rehearsal/server.mjs');
  const routes = new Map(), events = [], launches = [];
  const app = {
    get(path, handler) { routes.set(path, handler); },
    post(path, handler) { routes.set(path, handler); },
    addContentTypeParser() {},
    addHook(name, callback) { if (name === 'onClose') t.after(callback); },
  };
  const seed = Buffer.alloc(128);
  seed.writeUInt16BE(0xffd8);
  const root = resolve(__dirname, '../apps/world/rehearsal');
  await registerStage(app, {
    root, captureDir: root,
    newId: () => 'ep_' + launches.length,
    makePilot: () => () => ({ action: { key: 'NOOP' } }),
    bus: {
      publish(type, _lane, payload) { events.push({ type, ...payload }); },
      subscribe() { return () => {}; },
    },
    launchLive(callbacks) {
      launches.push(callbacks);
      return { send() {}, stop() {} };
    },
  });
  async function call(path, body) {
    let status = 200;
    const reply = { code(n) { status = n; return this; }, send(payload) { return payload; } };
    const data = await routes.get('/rehearsal/' + path)({ headers: { 'x-show-control': '1' }, body }, reply);
    return { status, data };
  }
  const start = () => call('start', { mode: 'genie', seed: seed.toString('base64') });
  await call('reset-photo');
  assert.equal((await start()).status, 200);
  t.mock.timers.tick(150);
  assert.equal(launches.length, 1);
  return {
    events, live: launches[0], start, call,
    state: async () => (await call('state')).data,
    ended: () => events.filter(e => e.type === 'episode.ended'),
  };
}

test('Genie timeout reaches Crowd at the deadline while the provider drains', async t => {
  const room = await liveStage(t);
  const started = Date.now(), deadline = started + 42_000;
  room.live.onMessage({expiresAt: deadline});
  room.live.onMessage({frame: Buffer.from('frame').toString('base64')});
  t.mock.timers.tick(42_005);
  room.live.onMessage({winner:'audience'});
  const result = await room.state();
  assert.equal(result.round.phase, 'ended');
  assert.equal(result.round.winner, 'audience');
  assert.equal(result.round.reason, 'time');
  assert.equal(result.round.finishedAt, deadline);
  assert.equal(room.ended().length, 1);
  assert.equal(room.ended()[0].durationMs, 42_000);
  assert.equal(room.ended()[0].genieClosedCleanly, null);
  assert.equal(result.providerClosing, true);
  assert.equal((await room.start()).status, 409);

  t.mock.timers.tick(27_000);
  room.live.onMessage({winner:'robot'});
  room.live.onMessage({observationFailed:true});
  room.live.onClose('completed');
  const closed = await room.state();
  assert.equal(closed.round.finishedAt, deadline);
  assert.equal(closed.round.providerClosedAt, Date.now());
  assert.equal(closed.round.terminal, 'completed');
  assert.equal(closed.round.action, 'stopped');
  assert.equal(closed.round.winner, 'audience');
  assert.equal(closed.providerClosing, false);
  assert.equal(room.ended().length, 1);
  assert.equal((await room.start()).status, 200);
});

test('a capture that ends without a winner interrupts the game even after its deadline', async t => {
  const room = await liveStage(t);
  room.live.onMessage({expiresAt:Date.now()+5_000});
  room.live.onMessage({frame: Buffer.from('frame').toString('base64')});
  t.mock.timers.tick(7_000);
  room.live.onClose('failed');
  room.live.onMessage({winner:'audience'});
  const state = await room.state();
  assert.equal(state.round.winner, null);
  assert.equal(state.round.reason, 'interrupted');
  assert.equal(state.providerClosing, false);
  assert.equal(room.ended().length, 1);
  assert.equal(room.ended()[0].reason, 'error');
  assert.equal(room.ended()[0].genieClosedCleanly, false);
});

test('an unconfirmed close before the first frame never starts or scores an episode', async t => {
  const room = await liveStage(t);
  room.live.onClose('cancel-requested');
  const state = await room.state();
  assert.equal(state.round.phase, 'ended');
  assert.equal(state.round.winner, null);
  assert.equal(state.round.reason, 'interrupted');
  assert.equal(state.providerClosing, true);
  assert.deepEqual(room.events, []);
  assert.equal((await room.call('reset-photo')).status, 200);
  assert.equal((await room.start()).status, 409);
  assert.equal((await room.call('start', {mode:'offline'})).status, 200);
});

test('a confirmed escape is scored once even if capture cleanup later fails', async t => {
  const room = await liveStage(t);
  room.live.onMessage({frame: Buffer.from('frame').toString('base64')});
  t.mock.timers.tick(1_200);
  room.live.onMessage({winner:'robot'});
  const gameOverAt = Date.now();
  t.mock.timers.tick(9_000);
  room.live.onClose('failed');
  const result = await room.state();
  assert.equal(result.round.reason, 'exit');
  assert.equal(result.round.finishedAt, gameOverAt);
  assert.equal(result.round.terminal, 'failed');
  assert.equal(result.round.providerClosedAt, Date.now());
  assert.equal(room.ended().length, 1);
  assert.equal(room.ended()[0].reason, 'success_claim');
});
