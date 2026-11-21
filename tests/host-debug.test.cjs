const { test } = require('node:test');
const assert = require('node:assert/strict');
const debug = import('../apps/world/rehearsal/host-debug.mjs');

test('the host distinguishes offline, preparation, live play and provider cleanup', async () => {
  const { readiness } = await debug;
  assert.match(readiness({canLive:false, plateReady:true}), /Offline host/);
  assert.match(readiness({canLive:true, platePreparing:true}), /Preparing/);
  assert.match(readiness({canLive:true, round:{phase:'playing',live:true}}), /Genie 4 live/);
  assert.match(readiness({providerClosing:true}), /Finishing/);
});

test('the private receipt keeps the rejection reason and calls a delivered idea delivered', async () => {
  const { privateReceipt } = await debug;
  assert.equal(privateReceipt({status:'rejected',moderated:{reason:'Try a smaller gust'}}), 'Try a smaller gust');
  assert.equal(privateReceipt({status:'injected',moderated:{safe:true,text:'A tiny gust'}}), 'Delivered to World · A tiny gust');
});

test('host observations follow the submitted obstacle separately from the latest move or another scare', async () => {
  const { observations } = await debug;
  const round = {live:true,seq:4,trackedAt:1100,trackedPose:'upright', action:'Stepping around an obstacle',
    lastReaction:{at:1125,flinch:true}, props:[{id:'first',reactedAt:1125}, {id:'second',acked:true}]};
  assert.deepEqual(observations(round,'second',1200), {pose:'upright',instruction:round.action,
    placement:'Delivered, awaiting sighting',response:'No confirmed reaction'});
  assert.equal(observations(round,'second',8100).pose,'No clear sighting');
  assert.equal(observations(round,'first',1200).response,'Flinched');
  assert.equal(observations({...round, live:false},'second',1200).pose,'Simulated');
});
