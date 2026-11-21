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
test('windup toys keep their identity when unrelated paper crosses the lane', async () => {
  const { describeEffect } = await moduleUnderTest;
  const toy = describeEffect('Tiny windup penguins march in unison, clicking softly.');
  assert.equal(toy.matches('scattered papers'), false);
  assert.equal(toy.matches('group of penguins'), true);
  assert.doesNotMatch(toy.hint, /stream of loose papers/);
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
  assert.deepEqual(sent[0], { pause: true, settleCamera: true, encounter:'one' });
  assert.ok(q.navigationPaused(1600));
  q.acknowledged('one', 1, 1200, 2);
  q.observe(scene([chair(700, 450)], { threat: 'startling', move:{intent:'hold'} }), 2, 1180, 1310);
  assert.equal(sent.filter((x) => x.reaction).length, 0);
  q.observe(scene([chair(700, 450)], { threat: 'startling', move:{intent:'hold'} }), 4, 2100, 2250);
  assert.ok(q.navigationPaused(2450));
  assert.equal(r.props[0].reactionRequestedAt, 2250);
  assert.equal(r.fear, 0);
  q.observe(scene([chair(700, 450)], { threat: 'startling', move:{intent:'hold'} }), 5, 2200, 2500);
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
test('ordinary, off-axis, ambiguous and missing threats earn no flinch cue or fear', async () => {
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
    assert.equal(q.navigationPaused(1580), ['off axis','missing'].includes(label), label);
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
  assert.equal(q.characterCommand(decision, 4000), null, 'one command per observed frame');
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
  assert.deepEqual(sent.filter(x => x.reaction), [{reaction:'notice', toward:'right', encounter:'wind', observed:8}]);
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

test('slow vision still presents a fresh card while preserving the original evidence time', async () => {
  const { hauntCue } = await import('../apps/world/rehearsal/haunt-cue.mjs');
  const p = {id:'chair', name:'A chair tips', selectedAt:1, seenAt:3000, inPathPresentedAt:9500, seen:true, inPath:true};
  const r = {phase:'playing', props:[p]};
  assert.equal(hauntCue(r, 9900).label, 'In the robot’s path');
  assert.equal(hauntCue(r, 15000), null);
  r.lastReaction = { at: 11000, presentedAt: 17500, name:p.name, flinch:true };
  assert.equal(hauntCue(r, 17800).label, 'The robot flinched');
  assert.equal(hauntCue(r, 21000), null);
});

test('a second committed haunting gets its own advance notice after the first encounter clears', async () => {
  const {createPlacementController} = await moduleUnderTest;
  const {hauntCue} = await import('../apps/world/rehearsal/haunt-cue.mjs');
  const r = {phase:'playing', props:[], fear:0, deadline:60000};
  const sent=[];
  const q=createPlacementController(r, x=>sent.push(x), ()=>{}, {cueLeadMs:1800});
  q.add('one','A chair tips','Moss',1000);
  q.observe(scene(), 1, 2710, 2750);
  q.tick(2800);
  q.acknowledged('one',1,2900,2);
  q.add('two','Marbles roll','Luna',13000);
  q.observe(scene([chair(670,450)]), 3, 13800, 14000);
  assert.equal(hauntCue(r,14000).text, 'A chair tips');
  q.observe(scene(), 4, 15300, 15500);
  assert.deepEqual(hauntCue(r,15500),{label:'Up next', text:'Marbles roll', by:'Luna'});
  q.observe(scene(),5,16600,16700);
  q.tick(17299);
  assert.equal(sent.filter(x=>x.haunt).length,1);
  q.tick(17300);
  assert.equal(sent.filter(x=>x.haunt).length,2);
});

test('the live card only shows an intent tied to this obstacle and observation', async () => {
  const { hauntCue } = await import('../apps/world/rehearsal/haunt-cue.mjs');
  const prop = { id: 'prop', name: 'A windup penguin', selectedAt: 100, seen: true, inPath: true, seenAt: 150 };
  const r = { phase: 'playing', live: true, observed: 12, trackedAt: 1200, trackedBody: [20, 40, 280, 180],
    props: [prop], intent: { hauntId: 'prop', observed: 12, at: 1300, key: 'D' } };
  assert.equal(hauntCue(r, 1400).intent, 'Trying a step right');
  assert.equal(hauntCue({ ...r, observed: 13 }, 1400).intent, undefined);
  assert.equal(hauntCue({ ...r, intent: null }, 1400).intent, undefined);
  assert.equal(hauntCue({ ...r, trackedAt: -2000 }, 1400).intent, undefined);
  assert.equal(hauntCue({ ...r, intent: { ...r.intent, hauntId: 'other' } }, 1400).intent, undefined);
  assert.equal(hauntCue({ ...r, intent: { ...r.intent, key: 'assess' } }, 1400).intent, 'Checking the path');
  prop.reactedAt = 1400;
  r.lastReaction = { at: 1400, flinch: true };
  assert.deepEqual(hauntCue(r, 1500), { label: 'The robot flinched', text: prop.name, by: undefined });
});

test('a changed actor lock defers the same haunting until a fresh footfall can aim it', async () => {
  const {createPlacementController} = await moduleUnderTest;
  const round = {props:[], fear:0, deadline:10000};
  const sent = [];
  const controller = createPlacementController(round, message => {
    if (message.haunt) sent.push(message.haunt);
  }, () => {});
  controller.add('penguin','Wind-up penguin','Moss Moth',100);
  controller.observe(scene(),1,100,110);
  assert.equal(sent[0].observed,1);
  controller.deferred('penguin',1,1);
  controller.tick(120);
  controller.observe(scene([], {visible:false}),2,130,140);
  assert.equal(sent.length,1);
  assert.equal(round.props[0].acked,false);
  controller.observe(scene(),3,150,160);
  assert.deepEqual(sent.map(s=>[s.id,s.attempt,s.observed]),[['penguin',1,1],['penguin',1,3]]);
  controller.deferred('penguin',1,1);
  assert.equal(round.props[0].placement,'sent');
});

test('a single visible player in a wide shot can receive a haunting when the same camera settles', async () => {
  const {createPlacementController} = await moduleUnderTest;
  const round = {props:[],fear:0,deadline:30_000};
  const sends = [];
  const controller = createPlacementController(round, value => { if (value.haunt) sends.push(value.haunt); }, () => {});
  const wide = scene([], {bodyBox:[359,251,957,481],playerCount:1,playerMatch:true,shoulderView:'rear-right'});
  controller.add('ghost','A wind-up penguin','Rusty Goblin',10_000);
  controller.observe(wide,170,11_000,12_000,false);
  assert.equal(sends.length,0);
  controller.moved(12_300);
  controller.observe(wide,191,12_200,12_800,true);
  assert.equal(sends.length,0);
  controller.observe(wide,245,13_000,14_000,true);
  assert.equal(sends.length,1);
  assert.equal(sends[0].observed,245);
  assert.equal(round.props[0].seen,false);
  assert.equal(round.fear,0);
});

test('hosted native observations keep the camera on the encounter through the slow read and detect uncommanded travel', async () => {
  const {createEncounterControls} = await import('../apps/world/painted-door/encounter-controls.mjs');
  const {createPlacementController} = await moduleUnderTest;
  // Native run 71ce8c7. The cue arrived at frame 207 while the read of 170
  // was in flight. These are the measured frames, arrival frames, times and
  // body boxes; the original recorder issued camera recovery at 299 and 379.
  const reads = [
    [170,233,6940,[355,210,968,460]],
    [245,299,10077,[359,251,957,481]],
    [310,379,12780,[366,252,940,484]],
    [391,453,16237,[378,281,930,517]],
    [465,538,19250,[390,328,928,532]],
  ];
  const gate = createEncounterControls(), sent = [];
  const q = createPlacementController({props:[],fear:0,deadline:90_000}, c => {
    sent.push(c);
    if (c.pause) gate.hold(c.encounter);
  }, () => {}, {cueLeadMs:1800});
  q.add('toy','A toy crosses the next step','Moss',8500);
  assert.equal(gate.permits({key:'W',observed:170}),false);
  let driftAt;
  for (const [observed,arrived,at,bodyBox] of reads) {
    const view = scene([], {bodyBox});
    const {stable,drift} = gate.measure(view,observed,observed>207);
    if (drift) driftAt=observed;
    const received = Math.round(arrived * 1000 / 24);
    q.observe(view,observed,at,received,stable);
    assert.ok(q.navigationPaused(received));
    assert.ok(gate.held,'no native camera correction may start or renew during this encounter');
    assert.equal(gate.permits({key:'W',observed}),false);
  }
  assert.deepEqual(sent.filter(x=>x.haunt).map(x=>x.haunt.observed),[310]);
  assert.equal(driftAt,465);
  assert.equal(sent.filter(x=>x.pause).length,1);
});

test('receipt alone cannot drive into a hazard, a real sidestep needs fresh post-effect pixels and cannot be replayed', async()=>{
  const {createEncounterControls} = await import('../apps/world/painted-door/encounter-controls.mjs');
  const {createPlacementController} = await moduleUnderTest;
  const view=scene([], {bodyBox:[310,64,940,376]});
  const gate=createEncounterControls(), commands=[];
  const q=createPlacementController({props:[],fear:0,deadline:100_000}, c=>{
    commands.push(c);
    if(c.pause) gate.hold(c.encounter);
    if(c.releaseEncounter) gate.release(c.releaseEncounter,100);
  },()=>{});
  q.add('slate','A slate tips over','Moss',1000);
  assert.equal(gate.measure(view,11,true).stable,false);
  assert.equal(gate.measure(view,15,true).stable,true);
  q.observe(view,15,1200,1300,true);
  assert.ok(gate.canPlace('slate',1,15));
  gate.placing('slate',1);
  assert.equal(gate.canPlace('slate',1,15),false);
  q.acknowledged('slate',1,1400,29);
  gate.acknowledge('slate',1,29);
  const obstacle=scene([chair(680,450,'slate')], {...view,obstacles:[chair(680,450,'slate')],move:{intent:'step_right',avoiding:true}});
  const forward={action:{key:'W',holdMs:250}}, right={action:{key:'D',holdMs:180},reaction:'avoid'};
  q.observe(obstacle,25,1350,6000,true);
  assert.equal(q.characterCommand(right,6000),null);
  assert.equal(gate.permits({encounter:'slate',key:'D',observed:25}),false);
  const checked=gate.measure(obstacle,66,true);
  q.observe(obstacle,66,6100,7900,checked.stable);
  assert.equal(q.characterCommand(forward,7900),null);
  const response={...q.characterCommand(right,7900),observed:66};
  assert.deepEqual(response,{key:'D',ms:180,encounter:'slate',reaction:'avoid',toward:'right',observed:66});
  assert.ok(gate.permits(response));
  gate.acted();
  assert.equal(gate.permits(response),false);
  assert.equal(q.characterCommand(right,7900),null);
  q.observe(view,55,4200,7950,true);
  assert.equal(q.characterCommand(right,7950),null);
  q.observe(view,99,9700,9900,true);
  assert.ok(commands.some(c=>c.releaseEncounter==='slate'));
  assert.equal(gate.permits({key:'W',observed:98}),false);
  assert.equal(gate.permits({key:'W',observed:101}),true);
  assert.equal(gate.permits(response),false);
});

test('a stalled placement is released once and gives the next proposal its own stationary observation',async()=>{
  const {createPlacementController}=await moduleUnderTest;
  const sent=[],reports=[];
  const q=createPlacementController({props:[],fear:0,deadline:120_000},c=>sent.push(c),(p,ok)=>reports.push([p.id,ok]));
  q.add('lost','A metal tray','Moss',100);
  q.add('next','A ring rolls into the aisle','Ivy',200);
  q.tick(30_101);q.tick(30_110);
  assert.deepEqual(reports,[['lost',false]]);
  assert.deepEqual(sent.filter(c=>c.pause).map(c=>c.encounter),['lost','next']);
  assert.deepEqual(sent.filter(c=>c.releaseEncounter).map(c=>c.releaseEncounter),['lost']);
  q.observe(scene(),500,30_000,30_200,true);
  assert.equal(sent.some(c=>c.haunt),false);
  q.observe(scene(),510,30_205,30_220,true);
  assert.equal(sent.filter(c=>c.haunt).at(-1).haunt.id,'next');
});

test('a light breeze can move existing paper from beside the aisle into the beam without spawning more sheets',async()=>{
  const {describeEffect,inspectPlacement}=await moduleUnderTest;
  const idea=describeEffect('A cool breeze nudges loose papers down the hallway.');
  assert.match(idea.hint,/gentle/);
  const sheet=(x,relation)=>({label:'loose sheet',box:[600,x-15,650,x+15],relation});
  const beside=[sheet(735,'beside')], crossing=sheet(450,'crossing');
  assert.ok(inspectPlacement(scene([crossing]),idea,beside).inPath);
  assert.equal(inspectPlacement(scene([beside[0]]),idea,beside).inPath,false);
  assert.equal(inspectPlacement(scene([crossing]),idea,[crossing]).inPath,false);
  assert.equal(inspectPlacement(scene([sheet(700,'crossing')]),idea,beside).inPath,false);
});
