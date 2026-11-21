// Run after npm run rehearsal:setup. The child runs the actual keyless Stage, Crowd and Brain.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { mock } = require('node:test');

const start = 1_800_000_000_000;
const tenMinutes = 600_000;

if (process.env.PG_REHEARSAL_TEST_CLOCK === '1' && process.send) {
  // Only the child’s game clock and scheduler use virtual time. HTTP still uses real sockets.
  mock.timers.enable({ apis: ['Date', 'setInterval'], now: start });
  process.on('message', ({ advance }) => {
    mock.timers.tick(advance);
    setImmediate(() => process.send({ now: Date.now() }));
  });
} else {
  run().catch(error => { console.error(error); process.exitCode = 1; });
}

async function run() {
  const root = resolve(__dirname, '..');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const origin = 'http://127.0.0.1:' + port;
  const host = fork(resolve(root, 'apps/world/rehearsal/run.mjs'), [], {
    cwd: root, execArgv: ['--require', __filename], stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PG_STAGE_PORT: String(port), PG_REHEARSAL_TEST_CLOCK: '1' },
  });
  const exit = once(host, 'exit');
  const guests = [{}, {}, {}], guest = guests[0];
  let now = start, milestone, nextGhostIdea, ghostName;

  async function request(path, { body, phone, control } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (phone) {
      headers['x-pg-client'] = 'phone';
      if (phone.cookie) headers.cookie = phone.cookie;
    }
    if (control) headers['x-show-control'] = '1';
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000),
    });
    if (phone && response.headers.has('set-cookie')) phone.cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    assert.ok(response.ok, path + ' returned ' + response.status + ' ' + JSON.stringify(result));
    return result;
  }

  const phoneState = () => request('/api/crowd/state?waitingPage=0', { phone: guest });
  const world = () => request('/rehearsal/state');
  const submit = async (phone, preset) => (await request('/api/crowd/haunt', { phone, body: { preset } })).hauntId;
  const startRound = () => request('/rehearsal/start', { control: true, body: { mode: 'offline' } });
  async function advance(ms) {
    const reply = once(host, 'message', { signal: AbortSignal.timeout(3000) });
    host.send({ advance: ms });
    now = (await reply)[0].now;
    await delay(3); // let the normal stage → Brain HTTP exchange settle
  }

  async function play(openingRound = false) {
    const { id } = await startRound();
    assert.equal((await world()).round.fear, 0);
    if (openingRound) {
      await advance(180);
      for (const [i, preset] of ['fog', 'paper-gust', 'lights-flicker'].entries())
        await submit(guests[i], preset);
    }
    for (let tick = 0; tick < 150; tick++) {
      const toMilestone = start + tenMinutes - now;
      await advance(toMilestone > 0 ? Math.min(600, toMilestone) : 600);
      const { round } = await world();
      assert.equal(round.id, id);
      if (now === start + tenMinutes) {
        const phone = await phoneState();
        assert.equal(phone.you.ghostName, ghostName);
        assert.equal(phone.mine.find(h => h.hauntId === nextGhostIdea)?.status, 'injected');
        milestone = { elapsedMs: now - start, ghost: phone.you.ghostName, round: id, phase: round.phase };
      }
      if (tick % 5 === 0) await phoneState();
      if (openingRound && round.phase === 'playing' && round.props.length === 3 && !nextGhostIdea)
        nextGhostIdea = await submit(guest, 'banana-peel');
      if (round.phase === 'ended') return round;
    }
    throw Error('Round did not finish within its rehearsal window');
  }

  try {
    await Promise.race([
      once(host.stdout, 'data', { signal: AbortSignal.timeout(5000) }),
      exit.then(([code]) => { throw Error('Rehearsal host exited with code ' + code); }),
    ]);
    assert.equal((await world()).canLive, false);
    await request('/rehearsal/reset-photo', { control: true, body: {} });
    ghostName = (await phoneState()).you.ghostName;
    const scare = await play(true);
    assert.equal(scare.reason, 'fear');
    assert.equal(scare.fear, 3);
    assert.equal((await phoneState()).mine.find(h => h.hauntId === nextGhostIdea)?.status, 'queued');
    const scores = () => request('/api/crowd/scoreboard');
    const earned = await scores();
    assert.equal(earned.attacks.landed, 3);
    assert.equal(earned.killFeed.filter(f => f.text.includes('scared the robot')).length, 3);
    const escape = await play();
    assert.equal(escape.reason, 'exit');
    assert.equal(escape.fear, 0);
    assert.ok((await scores()).killFeed.some(f => f.text.includes('made the robot sidestep')));
    let escapes = 1;
    while (!milestone) { assert.equal((await play()).reason, 'exit'); escapes++; }
    const finalRound = await startRound();
    await advance(200);
    await advance(72_150);
    const timed = (await world()).round;
    assert.equal(timed.id, finalRound.id);
    assert.equal(timed.winner, 'audience');
    assert.equal(timed.reason, 'time');
    const board = await scores();
    assert.equal(board.rounds, escapes + 2);
    assert.deepEqual(board.hallwayWins, { robot: escapes, audience: 2 });
    assert.equal(board.attacks.landed, 3);
    console.log(JSON.stringify({ milestone, totalVirtualMs: now - start, rounds: board.rounds, wins: board.hallwayWins, scares: board.attacks.landed }));
  } finally {
    host.kill();
    await exit;
  }
}
