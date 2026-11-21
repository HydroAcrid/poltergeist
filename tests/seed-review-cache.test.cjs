const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { setImmediate: turn } = require('node:timers/promises');
const root = resolve(__dirname, '../apps/world/rehearsal');
const stock = readFileSync(resolve(root, 'venue-opening.jpg'));
const receipt = JSON.parse(readFileSync(resolve(root, 'venue-opening.json')));

async function host(t, reviewSeed) {
  const { registerStage } = await import('../apps/world/rehearsal/server.mjs');
  const handlers = new Map();
  const app = { get(path, handle) { handlers.set(path, handle); }, post(path, handle) { handlers.set(path, handle); },
    addContentTypeParser() {}, addHook(name, fn) { if (name === 'onClose') t.after(fn); } };
  const providers = [];
  await registerStage(app, { root, captureDir:root, newId:()=>'fixture',
    bus:{subscribe:()=>()=>{}, publish(){}}, makePilot:()=>async()=>({}),
    generatePlate:async({photo})=>({bytes:photo,mime:'image/jpeg'}), reviewSeed,
    launchLive(options) { providers.push(options); return {stop(){},send(){}}; }
  });
  async function call(name, body) {
    let status = 200;
    const reply = { code(n) { status=n;return this; }, send(data) {return data;} };
    const data = await handlers.get('/rehearsal/'+name)({headers:{'x-show-control':'1'}, body}, reply);
    return {status,data};
  }
  return {call,providers};
}

test('the packaged venue uses the exact archived reviewed bytes; changing the room disables the shortcut', async t => {
  const { photoKey } = await import('../apps/world/rehearsal/photo-plate.mjs');
  const { reviewedVenueOpening } = await import('../apps/world/rehearsal/seed-review.mjs');
  assert.equal(photoKey(stock), receipt.seedSha256);
  assert.equal(reviewedVenueOpening(root, Buffer.from('different plate')), null);
  const {call, providers} = await host(t, async()=>{throw Error('Unexpected model call')});
  assert.equal((await call('state')).data.approvedVenueOpening, true);
  await call('reset-photo');
  const started = await call('start',{mode:'genie',useVenueOpening:true});
  assert.equal(started.status,200);
  for (let i=0;i<10&&!providers.length;i++) await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(photoKey(providers[0].seed),receipt.seedSha256);
});

test('a custom room cannot claim stock approval and conclusive rejections are reused by source and exact seed', async t => {
  const reviews=[];
  const {call} = await host(t, async bytes=>{reviews.push(Buffer.from(bytes));return {passes:false,routeVisible:false};});
  const bytes = Buffer.from(stock);bytes[20]^=1;
  const upload = async photo=>{
    assert.equal((await call('photo',photo)).status,200);
    await turn();
    return (await call('state')).data;
  };
  let state=await upload(bytes);
  assert.equal(state.approvedVenueOpening,false);
  const start = (overrides={})=>call('start',{mode:'genie',plateKey:state.plateKey,seed:bytes.toString('base64'),...overrides});
  assert.equal((await start({useVenueOpening:true})).status,409);
  assert.equal((await start({seed:stock.toString('base64')})).status,409);
  assert.equal(reviews.length,0);
  assert.match((await start()).data.error,/two clear strides/);
  assert.equal((await start()).status,422);
  await upload(bytes);
  assert.equal((await start()).status,422);
  assert.equal(reviews.length,1);
  const other=Buffer.from(bytes);other[21]^=1;
  assert.equal((await start({seed:other.toString('base64')})).status,422);
  state=await upload(other);
  assert.equal((await start()).status,422);
  assert.equal(reviews.length,3);
});

test('a transient review outage can be retried with the same seed', async t=>{
  let attempts=0;
  const {call} = await host(t,async()=>{if (++attempts===1) throw Error('temporary');return {passes:true};});
  const bytes=Buffer.from(stock);bytes[20]^=1;
  const payload={mode:'genie',seed:bytes.toString('base64')};
  assert.equal((await call('start',payload)).status,503);
  assert.equal((await call('start',payload)).status,200);
  assert.equal(attempts,2);
});
