const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

async function liveStage(t, choice = { action: { key: 'NOOP' } }) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000_000 });
  const { registerStage } = await import('../apps/world/rehearsal/server.mjs');
  const routes = new Map(), events = [], launches = [], commands = [];
  let dispatch;
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
    reviewSeed: async () => ({passes: true}),
    newId: () => 'ep_' + launches.length,
    makePilot: () => () => choice,
    bus: {
      publish(type, _lane, payload) { events.push({ type, ...payload }); },
      subscribe(_type, callback) { dispatch = callback; return () => {}; },
    },
    launchLive(callbacks) {
      launches.push(callbacks);
      return { send(command) { commands.push(command); }, stop() {} };
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
    events, commands, live: launches[0], start, call,
    submit(payload) { dispatch({type:"haunt.dispatch",payload}); },
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

test('the host keeps a verified wide-shot pose while camera recovery holds the player', async t => {
  const room = await liveStage(t, {action:{key:'W',holdMs:600},rationale:'Walking down the aisle'});
  room.live.onMessage({frame: Buffer.from('frame').toString('base64')});
  const scene = {visible:true,playerCount:1,pose:'upright',feetVisible:true,feet:{left:[957,285],right:[957,330]},
    bodyBox:[359,251,957,481],goal:[520,510],ahead:[715,510],obstacles:[]};
  room.live.onMessage({scene,observed:245,observedAt:Date.now(),trackingNavigationHeld:true,trackingPlacementReady:true});
  const {round} = await room.state();
  assert.deepEqual(round.trackedBody,scene.bodyBox);
  assert.equal(round.trackedPose,'upright');
  assert.equal(round.action,'Camera catching up to the robot');
  assert.equal(room.commands.some(command=>command.key),false);
});

test('the World records each held move and sends the Brain’s response only on its current confirmed encounter frame',async t=>{
  const choice={action:{key:'W',holdMs:220},rationale:'Walk down the aisle'};
  const room=await liveStage(t,choice);
  room.live.onMessage({frame:Buffer.from('frame').toString('base64')});
  const {round}=await room.state();
  const view={visible:true,playerCount:1,pose:'upright',feetVisible:true,feet:{left:[800,440],right:[800,460]},
    bodyBox:[300,134,880,432],goal:[400,510],ahead:[580,450],move:{intent:'walk'},obstacles:[]};
  const read=(n,patch={},tracking={})=>room.live.onMessage({scene:{...view,...patch},observed:n,
    observedAt:Date.now(),trackingPlacementReady:true,trackingNavigationHeld:false,...tracking});
  room.submit({episodeId:round.id,hauntId:'cart',text:'A cart rolls across the floor'});
  read(12);
  assert.equal(room.commands.at(-1).moveHeld.key,'W');
  assert.match(room.commands.at(-1).moveHeld.reason,/stationary visible footstep/);
  t.mock.timers.tick(2000);read(32);
  assert.equal(room.commands.find(c=>c.haunt).haunt.observed,32);
  room.live.onMessage({injected:'cart',attempt:1,injectedAt:Date.now(),injectedFrame:34});
  t.mock.timers.tick(3500);read(66);
  assert.equal(room.commands.some(c=>c.key),false);
  assert.equal(room.commands.filter(c=>c.haunt).length,2);
  room.live.onMessage({injected:'cart',attempt:2,injectedAt:Date.now(),injectedFrame:80});
  t.mock.timers.tick(3000);
  const threat={label:'cart',box:[560,430,690,470],solid:true};
  read(110,{obstacles:[threat]});
  assert.match(round.lastMoveHeld.reason,/ignore the visible obstacle/);
  assert.equal(round.lastMoveHeld.observed,110);
  choice.action={key:'D',holdMs:180};choice.reaction='avoid';
  t.mock.timers.tick(2200);
  read(171,{obstacles:[threat],move:{intent:'step_right',avoiding:true}}, {trackingNavigationHeld:true});
  assert.deepEqual(room.commands.filter(c=>c.key),[{key:'D',ms:180,encounter:'cart',reaction:'avoid',toward:'right',observed:171}]);
  read(150,{move:{intent:'walk'}});
  assert.equal(round.observed,171);
  assert.equal(room.commands.filter(c=>c.key).length,1);
  room.live.onMessage({moveHeld:{observed:171,key:'D',source:'native',reason:'Observation is over four seconds behind the native view'}});
  const {observations}=await import('../apps/world/rehearsal/host-debug.mjs');
  assert.match(observations(round,'cart',Date.now()).instruction,/Frame 171 · held D · Observation is over four seconds/);
});
