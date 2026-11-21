const {test} = require('node:test');
const assert = require('node:assert/strict');
const report = import('../apps/world/painted-door/framing-report.mjs');
const sample = (observed, bodyBox) => ({observed, scene:{visible:true, bodyBox}});

test('the captured zoom-in and retreat both fail the native framing check', async () => {
  const {assessFraming} = await report;
  const opening = sample(1,[430,143,807,298]);
  const approaching = assessFraming([opening, sample(80,[443,155,918,303]), sample(141,[435,63,1000,281])], 142);
  assert.equal(approaching.status, 'drift');
  assert.ok(approaching.issues.at(-1).faults.includes('clipped'));
  const receding = assessFraming([opening, sample(86,[458,359,722,452]), sample(163,[458,471,663,532])], 200);
  assert.equal(receding.status,'drift');
  assert.ok(receding.issues.at(-1).faults.includes('too distant'));
});

test('steady framing requires observations throughout the clip', async () => {
  const {assessFraming} = await report;
  const observations = [1,64,126,190].map(n => sample(n,[430,170,810,340]));
  assert.equal(assessFraming(observations,212).status, 'within framing at sampled times');
  assert.equal(assessFraming(observations,432).status, 'insufficient');
  assert.equal(assessFraming([],212).status,'insufficient');
});
