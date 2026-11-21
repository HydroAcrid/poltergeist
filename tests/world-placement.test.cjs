const test = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = import('../apps/world/rehearsal/placement.mjs');
const scene = (obstacles = [], extra = {}) => ({
  visible: true,
  feet: { left: [800, 440], right: [800, 460] },
  ahead: [580, 450],
  pose: 'upright',
  obstacles,
  ...extra,
});
const chair = (y, x, label = 'toppled chair') => ({
  label,
  box: [y - 130, x - 25, y, x + 25],
});

test('the target follows actual feet and heading and waits for a visible free floor', async () => {
  const { placementTarget } = await moduleUnderTest;
  assert.deepEqual(placementTarget(scene()), [606, 450]);
  assert.deepEqual(
    placementTarget(scene([], { ahead: [740, 300] })),
    [747, 318],
  );
  assert.equal(placementTarget(scene([], { visible: false })), null);
  assert.equal(
    placementTarget(scene([], { ahead: null, goal: [580, 450] })),
    null,
  );
  assert.equal(
    placementTarget(
      scene([
        { label: 'bench', box: [410, 395, 720, 500] },
        chair(620, 450),
        chair(585, 450),
      ]),
    ),
    null,
  );
});
test('waits when the next footfall would stage the prop at the camera edge', async () => {
  const { placementTarget } = await moduleUnderTest;
  // Observed during the live round: the requested chair fell outside the route.
  const edge = scene([], {feet:{left:[945,856], right:[939,935]}, ahead:[964,915]});
  assert.equal(placementTarget(edge), null);
  assert.equal(placementTarget(scene([], {feet:{left:[833,894],right:[841,902]},ahead:[818,946]})), null);
});
test('an off-axis, behind, missing or pre-existing chair cannot verify the haunt', async () => {
  const { inspectPlacement, describeEffect } = await moduleUnderTest;
  const chk = (objects, baseline = []) =>
    inspectPlacement(scene(objects), describeEffect('tip a chair'), baseline);
  assert.deepEqual(chk([chair(620, 450)]), {
    visible: true,
    inPath: true,
    contact: false,
    soleThreat: true,
  });
  assert.deepEqual(chk([chair(620, 650)]), {
    visible: true,
    inPath: false,
    contact: false,
    soleThreat: false,
  });
  assert.deepEqual(chk([chair(900, 450)]), {
    visible: true,
    inPath: false,
    contact: false,
    soleThreat: false,
  });
  assert.equal(chk([]).visible, false);
  assert.equal(chk([chair(620, 450)], [chair(620, 450)]).visible, false);
  assert.equal(
    chk(
      [chair(620, 450, 'chair'), chair(680, 650, 'chair')],
      [chair(620, 450, 'chair')],
    ).inPath,
    false,
  );
  assert.equal(
    chk([chair(620, 450)], [chair(620, 450, 'upright chair')]).inPath,
    true,
  );
});
test('papers in the path provide a visible gust and a free-text object uses its own identity', async () => {
  const { describeEffect, inspectPlacement } = await moduleUnderTest;
  const gust = describeEffect('A hurricane blows through');
  assert.match(gust.hint, /papers across/);
  assert.ok(
    inspectPlacement(scene([chair(650, 450, 'loose papers')]), gust, []).inPath,
  );
  const boots = describeEffect('Drop a roller skate onto the floor');
  assert.ok(
    inspectPlacement(scene([chair(650, 450, 'roller skate')]), boots, [])
      .inPath,
  );
  assert.equal(
    inspectPlacement(scene([chair(650, 450, 'chair')]), boots, []).visible,
    false,
  );
});
test('outdated or moved observations wait, and native ack alone cannot prove placement or score fear', async () => {
  const { createPlacementController } = await moduleUnderTest;
  const r = { props: [], fear: 0, deadline: 100000 };
  const sent = [],
    acks = [];
  const q = createPlacementController(
    r,
    (x) => {
      if (x.haunt) sent.push(x.haunt);
    },
    (p, ok) => acks.push(ok),
  );
  q.add('one', 'tip a chair', 'Moss Moth', 20000);
  q.add('one', 'tip a chair', 'Moss Moth', 20000);
  q.observe(scene(), 5, 1000, 20001);
  q.moved(20100);
  q.observe(scene(), 6, 20090, 20110);
  assert.equal(sent.length, 0);
  q.observe(scene(), 7, 20200, 20300);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].target, [606, 450]);
  q.acknowledged('one', 1, 20500, 10);
  q.acknowledged('one', 1, 20500, 10);
  assert.deepEqual(acks, [true]);
  assert.equal(r.props[0].seen, false);
  q.observe(scene([chair(765, 450)], { pose: 'stumbling' }), 8, 20350, 20600);
  assert.equal(r.fear, 0);
  assert.equal(r.props[0].seen, false);
  q.observe(scene([chair(620, 680)], { pose: 'stumbling' }), 12, 22500, 22900);
  assert.equal(r.props[0].seen, true);
  assert.equal(r.props[0].inPath, false);
  assert.equal(r.fear, 0);
  assert.equal(sent[1].attempt, 2);
  assert.match(sent[1].hint, /Relocate/);
  q.acknowledged('one', 2, 23000, 14);
  q.observe(scene([chair(700, 450)]), 20, 24000, 24100);
  assert.equal(r.props[0].inPath, true);
  assert.equal(r.fear, 0);
  q.observe(scene([chair(770, 450)], { pose: 'stumbling' }), 28, 25000, 25100);
  assert.equal(r.fear, 1);
  assert.equal(r.props[0].reactedAt, 25000);
  assert.deepEqual(acks, [true]);
});
test('one unsuccessful relocation cannot score, and unsent jobs fail cleanly at round end', async () => {
  const { createPlacementController } = await moduleUnderTest;
  const r = { props: [], fear: 0, deadline: 10000 },
    sent = [],
    reports = [];
  const q = createPlacementController(
    r,
    (x) => {
      if (x.haunt) sent.push(x.haunt);
    },
    (p, ok) => reports.push([p.id, ok]),
  );
  q.add('wind', 'gust', 'Ivy', 1000);
  q.observe(scene(), 5, 1000, 1050);
  q.acknowledged('wind', 1, 1200, 6);
  q.observe(scene(), 10, 2400, 2450);
  q.acknowledged('wind', 2, 2500, 11);
  q.observe(scene([chair(750, 760, 'papers')]), 20, 3900, 3950);
  q.moved(4100);
  q.add('new', 'chair', 'Ivy', 4250);
  q.finish();
  assert.equal(sent.length, 2);
  assert.equal(r.fear, 0);
  assert.equal(r.props[0].placement, 'off-path');
  assert.deepEqual(reports, [
    ['wind', true],
    ['new', false],
  ]);
});

test('a scoped native pause waits for the sighting then a clear threat gets one cue and evidence earns one scare', async () => {
  const { createPlacementController } = await moduleUnderTest;
  const r = { props: [], fear: 0, deadline: 50000 },
    sent = [];
  const q = createPlacementController(
    r,
    (x) => sent.push(x),
    () => {},
  );
  q.add('one', 'tip a chair', 'Moss', 1000);
  q.observe(scene([], { threat: 'startling' }), 1, 1050, 1100);
  assert.deepEqual(sent[0], { pause: true });
  assert.ok(q.navigationPaused(1600));
  q.acknowledged('one', 1, 1200, 2);
  q.observe(scene([chair(700, 450)], { threat: 'startling' }), 2, 1180, 1310);
  assert.equal(sent.filter((x) => x.reaction).length, 0);
  q.observe(scene([chair(700, 450)], { threat: 'startling' }), 4, 2100, 2250);
  assert.ok(q.navigationPaused(2450));
  assert.equal(r.props[0].reactionRequestedAt, 2250);
  assert.equal(r.fear, 0);
  q.observe(scene([chair(700, 450)], { threat: 'startling' }), 5, 2200, 2500);
  assert.equal(sent.filter((x) => x.reaction).length, 1);
  q.observe(
    scene([chair(700, 450)], { threat: 'startling', pose: 'startled' }),
    6,
    2240,
    2700,
  );
  assert.equal(r.fear, 0);
  q.observe(scene([chair(680, 450)], { threat: 'startling' }), 7, 2850, 2920);
  assert.equal(q.navigationPaused(3400), false);
  q.observe(
    scene([chair(675, 450)], { threat: 'startling', pose: 'startled' }),
    8,
    3200,
    3500,
  );
  q.observe(
    scene([chair(675, 450)], { threat: 'startling', pose: 'startled' }),
    9,
    3700,
    3800,
  );
  assert.equal(r.fear, 1);
  assert.equal(r.props[0].reactedAt, 3200);
  assert.equal(sent.filter((x) => x.reaction).length, 1);
});
test('ordinary, off-axis, ambiguous and missing threats resume navigation without a flinch cue or fear', async () => {
  const { createPlacementController } = await moduleUnderTest;
  for (const [label, obstacles, threat] of [
    ['normal', [chair(700, 450)], 'ordinary'],
    ['unknown', [chair(700, 450)], 'unclear'],
    ['off axis', [chair(700, 800)], 'startling'],
    ['missing', [], 'startling'],
    [
      'two objects',
      [chair(700, 450), chair(700, 447, 'rolling cart')],
      'startling',
    ],
  ]) {
    const r = { props: [], fear: 0, deadline: 30000 },
      sent = [];
    const q = createPlacementController(
      r,
      (x) => sent.push(x),
      () => {},
    );
    q.add('one', 'tip a chair', 'Moss', 1000);
    q.observe(scene(), 1, 1020, 1090);
    q.acknowledged('one', 1, 1100, 2);
    q.observe(scene(obstacles, { threat }), 3, 1500, 1580);
    assert.equal(q.navigationPaused(4100), false, label);
    assert.equal(sent.filter((x) => x.reaction).length, 0, label);
    assert.equal(r.fear, 0, label);
  }
});

test('audience gets a committed cue before send, then sees the actual placement stage', async () => {
  const { createPlacementController } = await moduleUnderTest;
  const { hauntCue } = await import('../apps/world/rehearsal/haunt-cue.mjs');
  const r = { phase: 'playing', props: [], fear: 0, deadline: 30000 };
  const sent = [];
  const q = createPlacementController(r, x => sent.push(x), () => {}, { cueLeadMs: 1800 });
  q.add('chair', 'A chair tips over', 'Moss Moth', 1000);
  assert.equal(hauntCue(r, 1020).label, 'Up next');
  q.observe(scene(), 20, 2410, 2450);
  q.tick(2799);
  assert.equal(sent.some(x => x.haunt), false);
  q.tick(2800);
  assert.equal(hauntCue(r, 2801).label, 'Taking effect');
  assert.equal(sent.filter(x => x.haunt).length, 1);
  q.acknowledged('chair', 1, 2820, 21);
  assert.equal(hauntCue(r, 2900).label, 'Taking effect');
  q.observe(scene([chair(680, 450)]), 23, 3600, 3800);
  assert.equal(hauntCue(r, 3801).label, 'In the robot’s path');
  const decision = {action: {key: 'D', holdMs: 220}};
  assert.equal(q.characterCommand(decision, 3900).reaction, 'avoid');
  assert.equal(q.characterCommand(decision, 4000).reaction, undefined);
  assert.equal(r.fear, 0);
});

test('visible airborne movement beside the robot can earn a glance but no collision or scare', async () => {
  const { createPlacementController } = await moduleUnderTest;
  const r = { phase: 'playing', props: [], fear: 0, deadline: 30000 };
  const sent = [];
  const q = createPlacementController(r, x => sent.push(x), () => {});
  q.add('wind', 'A paper gust', 'Moss Moth', 10);
  q.observe(scene(), 5, 100, 150);
  q.acknowledged('wind', 1, 200, 6);
  const off = {...chair(680, 740, 'loose papers'), relation: 'noticeable'};
  q.observe(scene([off]), 8, 1500, 1700);
  assert.deepEqual(sent.filter(x => x.reaction), [{reaction:'notice', toward:'right'}]);
  assert.equal(r.props[0].inPath, false);
  assert.equal(r.fear, 0);
  q.acknowledged('wind', 2, 1800, 9);
  q.observe(scene([off]), 10, 3100, 3200);
  assert.equal(sent.filter(x => x.reaction).length, 1);
  assert.equal(r.fear, 0);
});

test('a relocation cannot claim a chair that was already in the hallway', async () => {
  const {createPlacementController} = await moduleUnderTest;
  const r = {props: [], fear: 0, deadline: 20000};
  const q = createPlacementController(r, () => {}, () => {});
  const original = chair(610, 590, 'upright chair');
  const stray = chair(680, 760, 'tipped chair');
  q.add('one', 'tip a chair', 'Moss Moth', 0);
  q.observe(scene([original]), 1, 100, 150);
  q.acknowledged('one', 1, 200, 2);
  q.observe(scene([original, stray]), 5, 1500, 1700);
  q.acknowledged('one', 2, 1800, 6);
  q.observe(scene([original], {ahead:[600,590], threat:'startling'}), 8, 3100, 3200);
  assert.equal(r.props[0].inPath, false);
  assert.equal(r.props[0].reactionRequestedAt, undefined);
  assert.equal(r.fear, 0);
});
