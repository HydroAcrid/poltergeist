const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../apps/world/rehearsal');
const venue = readFileSync(resolve(root, '../painted-door/haunting/aisle.jpg'));
const second = readFileSync(
  resolve(root, '../painted-door/haunting/fixtures/clear-aisle.jpg'),
);
const stock = readFileSync(resolve(root, 'long-hall.webp'));
const turn = () => new Promise((done) => setImmediate(done));

async function openStage(t, generatePlate, reviewSeed = async () => ({passes: true})) {
  const routes = new Map(),
    close = [];
  const app = {
    get: (url, fn) => routes.set('GET ' + url, fn),
    post: (url, fn) => routes.set('POST ' + url, fn),
    addHook(name, fn) {
      if (name === 'onClose') close.push(fn);
    },
    addContentTypeParser() {},
  };
  const { registerStage } = await import('../apps/world/rehearsal/server.mjs');
  await registerStage(app, {
    root,
    captureDir: root,
    generatePlate,
    reviewSeed,
    bus: { subscribe: () => () => {} },
    newId: () => 'test',
    makePilot: () => () => {},
  });
  t.after(async () => {
    for (const fn of close) await fn();
  });
  return async (method, path, body, host = true) => {
    const res = {
      status: 200,
      payload: undefined,
      code(n) {
        this.status = n;
        return this;
      },
      header() {
        return this;
      },
      type() {
        return this;
      },
      send(payload) {
        this.payload = payload;
        return this;
      },
    };
    const result = await routes.get(method + ' /rehearsal/' + path)(
      { body, headers: host ? { 'x-show-control': '1' } : {} },
      res,
    );
    return { status: res.status, data: result === res ? res.payload : result };
  };
}

test('a host photo opens the lobby and prepares one matching plate while guests wait for Start', async (t) => {
  const jobs = [];
  const req = await openStage(t, ({ photo }) => {
    return new Promise((resolve) => jobs.push({
      photo,
      finish: () => resolve({ bytes: photo, mime: 'image/jpeg' }),
    }));
  });
  const lobby = async () => (await req('GET', 'lobby')).data;
  assert.equal((await lobby()).phase, 'before-photo');
  assert.deepEqual((await req('GET', 'plate')).data, stock);
  assert.equal((await req('POST', 'photo', venue, false)).status, 403);
  assert.equal(jobs.length, 0);

  const { data: upload } = await req('POST', 'photo', venue);
  const waiting = await lobby();
  assert.equal(waiting.phase, 'lobby');
  assert.equal(waiting.preparing, true);
  assert.equal(waiting.ready, false);
  assert.equal((await req('GET', 'plate')).status, 409);
  assert.equal((await req('POST', 'prepare-photo', { revision: upload.revision }, false)).status, 403);
  assert.equal((await req('POST', 'start', {mode: 'genie', seed: venue.toString('base64')})).status, 409);
  assert.equal((await req('POST', 'prepare-photo', { revision: upload.revision })).status, 202);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].photo, venue);

  await req('POST', 'photo', second);
  assert.equal(jobs.length, 2);
  jobs[0].finish();
  await turn();
  assert.equal((await lobby()).ready, false, 'Late completion must not replace the newer room');
  assert.equal((await req('POST', 'prepare-photo', { revision: upload.revision })).status, 409);
  await req('POST', 'photo', venue);
  const ready = (await req('GET', 'state')).data;
  assert.equal(ready.plateReady, true);
  assert.equal(ready.lobby.phase, 'lobby');
  assert.equal(ready.round, null, 'The crowd can wait after preparation completes');
  assert.deepEqual((await req('GET', 'plate')).data, venue);
  assert.equal((await req('POST', 'prepare-photo', {})).status, 200);
  assert.equal(jobs.length, 2, 'An exact reupload reuses its prepared plate');
  jobs[1].finish();
  await turn();
  const body = { mode: 'genie', seed: second.toString('base64') };
  assert.equal((await req('POST', 'start', { ...body, plateKey: 'stale' })).status, 409);
  const started = await req('POST', 'start', { ...body, plateKey: ready.plateKey });
  assert.equal(started.status, 200);
  assert.equal(started.data.openingMs, 0);
  assert.equal((await lobby()).phase, 'starting');
});

test('generation failure exposes a retryable public error without revealing provider details', async (t) => {
  let calls = 0;
  const req = await openStage(t, async () => {
    if (++calls === 1) throw Error('sensitive provider diagnostic');
    return { bytes: second, mime: 'image/jpeg' };
  });
  await req('POST', 'photo', second);
  await turn();
  const failed = (await req('GET', 'state')).data;
  assert.equal(failed.plateReady, false);
  assert.equal(failed.platePreparing, false);
  assert.match(failed.plateError, /try again/i);
  assert.doesNotMatch(failed.plateError, /sensitive/);
  await req('POST', 'prepare-photo', {});
  await turn();
  assert.equal((await req('GET', 'state')).data.plateReady, true);
});

test('a duplicate or unconfirmed player never starts a paid world, even with a valid JPEG', async t => {
  let approve;
  let checks = 0;
  const req = await openStage(t, undefined, async () => {
    checks++;
    return new Promise(done => { approve = done; });
  });
  const seed = second.toString('base64');
  const opening = () => req('POST', 'start', { mode: 'genie', seed });
  const first = opening();
  assert.equal((await opening()).status, 409);
  approve({passes: false});
  assert.equal((await first).status, 422);
  assert.equal((await req('GET', 'state')).data.round, null);
  const outdated = opening();
  await req('POST', 'reset-photo');
  approve({passes: true});
  assert.equal((await outdated).status, 409);
  const valid = opening();
  approve({passes: true});
  assert.equal((await valid).status, 200);
  assert.equal(checks, 3);
});
