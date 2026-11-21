const {test} = require('node:test');
const assert = require('node:assert/strict');
const report = import('../apps/world/painted-door/framing-report.mjs');
const sample = (observed, bodyBox) => ({observed, scene:{visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',aisleHeading:'diagonal-right', rightFloorVisible:true, bodyBox}});

test('the captured zoom-in and retreat both fail the native framing check', async () => {
  const {assessFraming} = await report;
  const opening = sample(1,[430,143,807,298]);
  const approaching = assessFraming([opening, sample(80,[443,155,918,303]), sample(141,[435,63,1000,281])], 142);
  assert.equal(approaching.status, 'drift');
  assert.ok(approaching.issues.at(-1).faults.includes('too distant'));
  const receding = assessFraming([opening, sample(86,[458,359,722,452]), sample(163,[458,471,663,532])], 200);
  assert.equal(receding.status,'drift');
  assert.ok(receding.issues.at(-1).faults.includes('too distant'));
});

test('steady framing requires observations throughout the clip', async () => {
  const {assessFraming} = await report;
  const observations = [1,64,126,190].map(n => sample(n,[340,65,930,355]));
  assert.equal(assessFraming(observations,212).status, 'within framing at sampled times');
  assert.equal(assessFraming(observations,432).status, 'insufficient');
  assert.equal(assessFraming([],212).status,'insufficient');
});


test('right-shoulder composition tolerates the intended lower crop but preserves the head and route', async()=>{
  const {assessFraming}=await report;
  const observations=[1,48,96].map(n=>({observed:n,scene:{visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',aisleHeading:'diagonal-right',bodyBox:[340,65,930,355],feetVisible:false,rightFloorVisible:true}}));
  assert.equal(assessFraming(observations,120).status,'within framing at sampled times');
  observations[1].scene.bodyBox=[0,65,930,355];
  observations[1].scene.rightFloorVisible=false;
  assert.deepEqual(assessFraming(observations,120).issues[0].faults,['clipped','route obscured']);
});

test('a matching body rectangle alone cannot certify one continuously followed actor',async()=>{
  const {assessFraming}=await report;
  const samples=[1,48,95].map(frame=>sample(frame,[340,65,930,355]));
  samples[1].scene.playerCount=2;
  assert.deepEqual(assessFraming(samples,119).issues[0].faults,['multiple players']);
  samples[1].scene.playerCount=1;
  samples[1].tracking={held:true};
  assert.equal(assessFraming(samples,119).status,'insufficient');
});

test('accepts visible boots in the lower-left diagonal and rejects the recorded small centered robot',async()=>{
  const {assessFraming}=await report;
  const samples=[1,64,126].map(f=>sample(f,[340,65,895,355]));
  for(const {scene} of samples) scene.feetVisible=true;
  assert.equal(assessFraming(samples,158).status,'within framing at sampled times');
  samples[1].scene.aisleHeading='head-on';
  assert.ok(assessFraming(samples,158).issues[0].faults.includes('aisle lost the upper-right diagonal'));
  samples[1].scene.bodyBox=[456,396,904,567]; // Native source frame 691 of the second hosted take.
  assert.deepEqual(assessFraming(samples,158).issues[0].faults,['too distant','left the shoulder framing','aisle lost the upper-right diagonal']);
  samples[1].scene.aisleHeading='side-on';
  assert.equal(assessFraming(samples,158).status,'drift');
});
