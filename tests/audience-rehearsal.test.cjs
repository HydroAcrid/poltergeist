const { test } = require('node:test');
const assert = require('node:assert/strict');
const game = import('../apps/world/rehearsal/game.mjs');
test('a thirty-second opening holds the clock, robot and effects', async () => {
  const g = await game,
    r = g.newRound('test', 100);
  assert.equal(g.beginPlay(r, 30099), false);
  assert.equal(g.place(r, { hauntId: 'x', text: 'fog' }, 301), false);
  assert.equal(g.beginPlay(r, 30100), true);
  assert.equal(r.deadline - r.startedAt, g.playMs);
});
test('three distinct confirmed flinches win while queueing and clean avoidance earn nothing', async () => {
  const g = await game,
    r = g.newRound('test', 0);
  g.beginPlay(r, 30000);
  const encounter = (id, text, decision, now) => {
    assert.ok(g.place(r, { hauntId: id, text }, now));
    r.depth += 0.045;
    const seen = g.observe(r);
    g.applyDecision(r, seen, decision, now + 1250);
    g.applyDecision(r, seen, decision, now + 1750);
  };
  encounter('peel', 'banana peel', { action: { key: 'A' } }, 31000);
  assert.equal(r.fear, 0);
  for (const [i, name] of ['flicker', 'fog', 'papers'].entries()) {
    encounter(
      name,
      name,
      { action: { key: 'NOOP' }, mode: 'unstick' },
      36000 + i * 10000,
    );
    assert.equal(r.fear, i + 1, 'One point per confirmed flinch');
  }
  assert.deepEqual([r.winner, r.reason], ['audience', 'fear']);
});
test('a clear hallway spans all three bays and the clock can independently end play', async () => {
  const g = await game,
    r = g.newRound('test', 0);
  g.beginPlay(r, 30000);
  for (let i = 1; i <= 74; i++)
    g.applyDecision(
      r,
      g.observe(r),
      { action: { key: 'W', holdMs: 600 } },
      30000 + i * 600,
    );
  assert.ok(r.depth < 1);
  for (let i = 0; i < 2; i++)
    g.applyDecision(
      r,
      g.observe(r),
      { action: { key: 'W', holdMs: 600 } },
      75500 + i * 600,
    );
  g.applyDecision(
    r,
    g.observe(r),
    { action: { key: 'NOOP' }, successClaim: true },
    77000,
  );
  assert.equal(r.winner, 'robot');
  const r2 = g.newRound('another', 0);
  g.beginPlay(r2, 30000);
  g.applyDecision(
    r2,
    g.observe(r2),
    { action: { key: 'W', holdMs: 600 } },
    102000,
  );
  assert.deepEqual([r2.winner, r2.reason], ['audience', 'time']);
});
