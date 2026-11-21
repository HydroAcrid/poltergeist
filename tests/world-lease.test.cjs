const {test} = require('node:test');
const assert = require('node:assert/strict');

test('hosting uses the absolute stop time of the current SDK session',async()=>{
  const {sessionDeadline} = await import('../apps/hosting/world-lease.mjs');
  assert.equal(sessionDeadline({createdAt:new Date(50_000),timeout:45*60_000}),2_750_000);
  assert.throws(()=>sessionDeadline({createdAt:undefined,timeout:70_000}));
});

test('the active game reserves time for real handoffs while the wall-clock demo fits an exact five minutes',async()=>{
  const {worldLeaseWarning} = await import('../apps/hosting/world-lease.mjs');
  const start={mode:'ten-minute-game',durationMs:600_000,now:2_000_000,requestedAt:2_000_000,openingMs:0,cutMs:55_000};
  const required=600_000 + 21 * 35_000;
  assert.equal(worldLeaseWarning({...start,deadline:start.now+required}),null);
  assert.equal(worldLeaseWarning({...start,deadline:start.now+required-1}).requiredMs,required);
  assert.equal(worldLeaseWarning({...start,deadline:''}),null);
  assert.equal(worldLeaseWarning({...start,mode:'five-minute-demo',durationMs:300_000,now:start.now+3_000,deadline:start.now+300_000}),null);
  assert.equal(worldLeaseWarning({...start,mode:'five-minute-demo',durationMs:300_000,deadline:start.now+299_999}).requiredMs,300_000);
  assert.equal(worldLeaseWarning({...start,mode:'camera-test',durationMs:45_000,openingMs:30_000,deadline:start.now+109_999}).requiredMs,110_000);
});

test('cold start extends a short configurable lease in place and keeps the real stop time when the plan refuses',async()=>{
  const {prepareColdHostLease} = await import('../apps/hosting/world-lease.mjs');
  const session = {createdAt:new Date(0),timeout:900_000,async extendTimeout(add){this.timeout+=add;}};
  assert.equal(await prepareColdHostLease(session,0),1_365_000);
  let called=false;
  const fullSession = {createdAt:new Date(0),timeout:2_700_000,async extendTimeout(){called=true;throw Error('plan maximum');}};
  assert.equal(await prepareColdHostLease(fullSession,0),2_700_000);
  assert.equal(called,false);
  assert.equal(await prepareColdHostLease(fullSession,2_000_000),2_700_000);
  assert.equal(called,true);
});
