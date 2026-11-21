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

async function openStage(t, generatePlate) {
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

test('only an explicit host request can prepare a photo and the live room must use that photo’s ready plate', async (t) => {
  let calls = 0,
    finish;
  const req = await openStage(t, async ({ photo, reference }) => {
    calls++;
    assert.deepEqual(photo, venue);
    assert.deepEqual(reference, stock);
    await new Promise((done) => (finish = done));
    return { bytes: photo, mime: 'image/jpeg' };
  });
  assert.deepEqual((await req('GET', 'plate')).data, stock);
  const { data: upload } = await req('POST', 'photo', venue);
  assert.equal((await req('GET', 'state')).data.plateReady, false);
  assert.equal((await req('GET', 'plate')).status, 409);
  assert.equal(
    (await req('POST', 'prepare-photo', { revision: upload.revision }, false))
      .status,
    403,
  );
  assert.equal(
    (
      await req('POST', 'start', {
        mode: 'genie',
        seed: venue.toString('base64'),
      })
    ).status,
    409,
  );
  assert.equal(
    calls,
    0,
    'Upload and blocked start must make zero generation calls',
  );
  assert.equal(
    (await req('POST', 'prepare-photo', { revision: upload.revision })).status,
    202,
  );
  assert.equal(
    (await req('POST', 'prepare-photo', { revision: upload.revision })).data
      .platePreparing,
    true,
  );
  assert.equal(calls, 1);
  await req('POST', 'photo', second);
  finish();
  await turn();
  assert.equal(
    (await req('GET', 'state')).data.plateReady,
    false,
    'Late completion must not replace the newer room',
  );
  assert.equal(
    (await req('POST', 'prepare-photo', { revision: upload.revision })).status,
    409,
  );
  await req('POST', 'photo', venue);
  const ready = (await req('GET', 'state')).data;
  assert.equal(ready.plateReady, true);
  assert.deepEqual((await req('GET', 'plate')).data, venue);
  assert.equal((await req('POST', 'prepare-photo', {})).status, 200);
  assert.equal(calls, 1, 'Exact reuploads must reuse the existing plate');
  const body = { mode: 'genie', seed: second.toString('base64') };
  assert.equal(
    (await req('POST', 'start', { ...body, plateKey: 'stale' })).status,
    409,
  );
  assert.equal(
    (await req('POST', 'start', { ...body, plateKey: ready.plateKey })).status,
    200,
  );
});

test('generation failure exposes a retryable public error without revealing provider details', async (t) => {
  let calls = 0;
  const req = await openStage(t, async () => {
    if (++calls === 1) throw Error('sensitive provider diagnostic');
    return { bytes: second, mime: 'image/jpeg' };
  });
  await req('POST', 'photo', second);
  await req('POST', 'prepare-photo', {});
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
