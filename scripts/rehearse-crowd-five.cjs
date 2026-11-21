// Run after npm run rehearsal:setup. All traffic stays on a fresh keyless loopback server.
// 300 cookie jars arrive together and poll every two game seconds.
// Add --match for a single 5-minute episode with a fixture World and three handoffs.
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');

const count = Number(process.argv.slice(2).find((arg) => arg !== '--match') ?? 300);
assert.ok(Number.isInteger(count) && count > 0);
const duration = 300_000;
const sustained = process.argv.includes('--match');
const presets = ['banana-peel', 'mop-bucket', 'chair-tips', 'paper-gust', 'marbles', 'fog', 'lights-flicker'];

async function run() {
  const root = resolve(__dirname, '..');
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const program = sustained
    ? 'apps/crowd/node_modules/vite-node/vite-node.mjs'
    : 'apps/world/rehearsal/run.mjs';
  const args = sustained
    ? ['--config', 'apps/crowd/dev/rehearsal.config.mjs', 'apps/crowd/dev/five-minute-match.ts']
    : [];
  const host = fork(resolve(root, program), args, {
    cwd: root,
    execArgv: ['--require', resolve(__dirname, 'rehearse-room-span.cjs')],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PG_STAGE_PORT: String(port),
      PG_REHEARSAL_TEST_CLOCK: '1',
    },
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  });
  const exited = once(host, 'exit');
  const origin = 'http://127.0.0.1:' + port;
  const guests = Array.from({ length: count }, () => ({ ids: new Set() }));
  const stats = new Map(),
    picks = new Set(),
    roundIds = new Set(),
    byMinute = Array(5).fill(0);
  let active = 0,
    peak = 0,
    failures = 0,
    cacheHits = 0,
    pendingAtEnd = 0,
    bodyBytes = 0,
    conductorPicks = 0;
  const boundaries = new Map();
  let totalWallGameMs = 0;

  async function request(category, path, { guest, body, control, tag } = {}) {
    const started = performance.now();
    const headers = {};
    if (guest) {
      headers['x-pg-client'] = 'phone';
      if (guest.cookie) headers.cookie = guest.cookie;
    }
    if (tag) headers['if-none-match'] = tag;
    if (control) headers['x-show-control'] = '1';
    if (body) headers['content-type'] = 'application/json';
    active++;
    peak = Math.max(peak, active);
    try {
      const response = await fetch(origin + path, {
        headers,
        method: body ? 'POST' : 'GET',
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const bytes = await response.arrayBuffer();
      bodyBytes += bytes.byteLength;
      if (response.headers.has('set-cookie')) {
        assert.ok(guest && !guest.cookie, 'unexpected cookie replacement');
        guest.cookie = response.headers.get('set-cookie').split(';')[0];
      }
      if (response.status === 304) {
        assert.ok(tag && response.headers.get('etag') === tag && !bytes.byteLength);
        cacheHits++;
        return guest.state;
      }
      assert.equal(response.status, 200, path + ' ' + Buffer.from(bytes).toString().slice(0, 140));
      const value = JSON.parse(Buffer.from(bytes).toString());
      if (category === 'arrive' || category === 'poll') {
        guest.tag = response.headers.get('etag');
        assert.ok(guest.tag);
        guest.state = value;
      }
      return value;
    } catch (err) {
      failures++;
      throw err;
    } finally {
      active--;
      if (!stats.has(category)) stats.set(category, []);
      stats.get(category).push(performance.now() - started);
    }
  }

  async function step(ms) {
    const reply = once(host, 'message', { signal: AbortSignal.timeout(10_000) });
    host.send({ advance: ms });
    await reply;
    await delay(3); // finish a pending Brain HTTP exchange before advancing the game clock again
  }
  async function phone(guest, first = false) {
    const s = await request(first ? 'arrive' : 'poll', '/api/crowd/state?waitingPage=0', {
      guest,
      tag: first ? undefined : guest.tag,
    });
    if (first) guest.name = s.you.ghostName;
    assert.ok(guest.name && s.you.ghostName === guest.name);
    assert.equal(s.mine.length, guest.ids.size);
    for (const h of s.mine) assert.ok(guest.ids.has(h.hauntId), 'private receipt belonged to another guest');
    assert.ok(s.mine.filter((h) => ['submitted', 'approved', 'queued'].includes(h.status)).length <= 1);
    assert.ok(s.queue.length <= 16 && s.waiting?.size === 15);
    for (const h of [...s.queue, ...s.hallway])
      assert.ok(h.moderated?.safe && !h.raw && !h.deviceId && !h.moderated.reason && !h.moderated.suggestion);
    return s;
  }
  async function send(guest, body) {
    const { hauntId } = await request('submit', '/api/crowd/haunt', { guest, body });
    assert.ok(hauntId && !guest.ids.has(hauntId));
    guest.ids.add(hauntId);
    return hauntId;
  }
  const all = (fn) => Promise.all(guests.map(fn));
  const world = () => request('world', '/rehearsal/state');
  const startRound = () => request('host', '/rehearsal/start', { body: { mode: 'offline' }, control: true });

  try {
    await Promise.race([
      once(host.stdout, 'data', { signal: AbortSignal.timeout(10_000) }),
      exited.then(() => {
        throw Error('Host exited during startup');
      }),
    ]);
    assert.equal((await world()).canLive, false);
    await request('host', '/rehearsal/reset-photo', { control: true, body: {} });
    const wallStart = performance.now();
    await all((g) => phone(g, true));
    assert.equal(new Set(guests.map((g) => g.name)).size, count);
    assert.equal(new Set(guests.map((g) => g.cookie)).size, count);
    await all(async (g, i) => {
      g.first = await send(g, {
        text: i % 2 ? 'A chair rolls into the aisle' : 'A gust blows paper down the hallway',
      });
    });
    const before = await all((g) => phone(g));
    assert.ok(before.every((s) => s.joined === count && s.mine[0].status === 'queued'));
    await step(20_001); // replacement cooldown, still in the pregame lobby
    await all(async (g, i) => {
      g.replacement = await send(g, { preset: presets[i % presets.length] });
    });
    const replaced = await all((g) => phone(g));
    assert.ok(
      replaced.every(
        (s, i) =>
          s.mine.find((h) => h.hauntId === guests[i].first)?.status === 'withdrawn' &&
          s.mine.find((h) => h.hauntId === guests[i].replacement)?.status === 'queued' &&
          s.waiting.total + 1 === count,
      ),
    );
    console.error(
      JSON.stringify({
        phase: 'lobby',
        aliases: count,
        replacementsVerified: count,
        elapsedSeconds: +((performance.now() - wallStart) / 1000).toFixed(2),
      }),
    );

    await startRound();
    for (let elapsed = 0; elapsed < duration; ) {
      for (let i = 0; i < 4; i++) await step(500);
      totalWallGameMs += 2_000;
      assert.ok(totalWallGameMs <= duration + 90_000, 'Game clock stuck during a handoff');
      const snapshot = await world();
      const round = snapshot.round;
      assert.ok(!round.live);
      roundIds.add(round.id);
      elapsed = sustained ? round.durationMs-round.remainingMs : totalWallGameMs;
      const observations = sustained
        ? round.dispatches.map((d) => {
            assert.equal(d.episodeId, round.id);
            return d.hauntId;
          })
        : round.props.map((p) => p.id);
      for (const id of observations)
        if (!picks.has(id)) {
          picks.add(id);
          byMinute[Math.floor((elapsed - 1) / 60_000)]++;
        }
      const phones = await all((g) => phone(g));
      const state = phones[0];
      assert.equal(state.joined, count);
      if (state.upNext?.mode === 'conductor') conductorPicks++;
      pendingAtEnd = state.waiting.total + Number(state.queue.length > 0);
      if (sustained) {
        assert.equal(snapshot.episodeStarts, 1);
        assert.equal(snapshot.episodeEnds, elapsed === duration ? 1 : 0);
        if (round.phase === 'handoff') {
          assert.ok(
            phones.every(
              (s) => s.episodeActive && s.roundEndsAt === round.deadline && s.roundPausedRemainingMs === undefined,
            ),
          );
          const previous = boundaries.get(round.chapter);
          if (previous) {
            assert.equal(picks.size, previous.dispatched);
            assert.ok(round.remainingMs < previous.remainingMs);
          } else {
            const i = phones.findIndex((s) =>
              s.mine.some((h) => h.status === 'queued' && h.hauntId !== s.upNext?.hauntId),
            );
            assert.ok(i >= 0);
            const g = guests[i],
              old = g.replacement;
            g.replacement = await send(g, { preset: presets[round.chapter] });
            const receipt = await phone(g);
            assert.equal(receipt.mine.find((h) => h.hauntId === old)?.status, 'withdrawn');
            assert.equal(receipt.mine.find((h) => h.hauntId === g.replacement)?.status, 'queued');
            boundaries.set(round.chapter, { dispatched: picks.size, remainingMs: round.remainingMs });
          }
        } else if (round.phase === 'playing') {
          assert.ok(
            phones.every((s) => !('roundPausedRemainingMs' in s) && s.roundEndsAt === round.deadline),
          );
        }
      } else if (round.phase === 'ended' && elapsed !== duration) await startRound();
    }
    const final = await all((g) => phone(g));
    const currentIdeas = final.map((state, i) => state.mine.find((h) => h.hauntId === guests[i].replacement));
    const statuses = {};
    for (const h of currentIdeas) statuses[h.status] = (statuses[h.status] || 0) + 1;
    const injected = statuses.injected || 0;
    assert.ok(
      byMinute.every((n) => n > 0),
      'No audience effects in at least one game minute',
    );
    assert.ok(conductorPicks > 0, 'Conductor never selected a candidate');
    assert.equal(injected, picks.size);
    assert.equal(statuses.queued || 0, pendingAtEnd);
    if (sustained) assert.equal(injected + pendingAtEnd, count);
    const liveRound = (await world()).round;
    for (const h of currentIdeas.filter((h) => h.status === 'dispatched'))
      assert.ok(
        liveRound.phase === 'playing' &&
          liveRound.id === h.episodeId &&
          liveRound.upcoming?.some((p) => p.id === h.hauntId),
        'A committed idea was orphaned at the end of round ' + h.episodeId,
      );

    if (sustained) {
      assert.equal(roundIds.size, 1);
      assert.equal(boundaries.size, 3);
      const board = await request('score', '/api/crowd/scoreboard');
      assert.equal(board.rounds, 1);
      assert.equal(board.attacks.injected, injected);
    }
    const timings = {};
    for (const [name, samples] of stats) {
      samples.sort((a, b) => a - b);
      const percentile = (p) => +samples[Math.ceil(p * samples.length) - 1].toFixed(1);
      timings[name] = {
        requests: samples.length,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: percentile(1),
      };
    }
    console.log(
      JSON.stringify({
        mode: sustained
          ? 'real Crowd HTTP and conductor, fixture World with acknowledgments'
          : 'real offline Stage, fixture Brain and Crowd HTTP',
        virtualGameMs: duration,
        virtualWallMsDuringPlay: totalWallGameMs,
        realSeconds: +((performance.now() - wallStart) / 1000).toFixed(2),
        phones: count,
        uniqueAliases: count,
        distinctCookies: count,
        privateReceipts: guests.reduce((n, g) => n + g.ids.size, 0),
        withdrawnReplacements: count + boundaries.size,
        guestsStillHere: final[0].joined,
        sessionLoss: 0,
        requestFailures: failures,
        maxConcurrentRequests: peak,
        conditionalHits: cacheHits,
        responseBodyBytes: bodyBytes,
        rounds: roundIds.size,
        handoffs: boundaries.size,
        ...(sustained ? { dispatchByMinute: byMinute } : { offlinePlacementByMinute: byMinute }),
        injected,
        finalReceiptStatuses: statuses,
        queued: pendingAtEnd,
        pollWavesWithConductorPick: conductorPicks,
        timings,
      }),
    );
  } finally {
    if (host.exitCode === null) host.kill();
    await exited;
  }
}
run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
