const {test} = require('node:test');
const assert = require('node:assert/strict');
test('crossing needs a near real threshold, applied travel and a later view through the doorway', async()=>{
  const {observedCrossing: seen}=await import('../apps/world/rehearsal/crossing.mjs');
  const state={};
  const doorway=(doorwayProgress,y)=>({visible:true,doorwayProgress,goal:[y,480]});
  assert.equal(seen(state,doorway('at-threshold',390),1000),false);
  state.forwardAt=1100;
  assert.equal(seen(state,doorway('through',920),2000),false);
  assert.equal(seen(state,doorway('at-threshold',930),3000),false);
  assert.equal(seen(state,doorway('through',950),4100),false);
  state.forwardAt=4200;
  assert.equal(seen(state,doorway('through',950),5300),true);
});

test('the final step requires a clear sighted doorway and a fresh Brain arrival decision', async () => {
  const {canCrossThreshold} = await import('../apps/world/rehearsal/crossing.mjs');
  const track = {thresholdAt: 800};
  const scene = {visible: true, pose: 'upright', doorwayProgress: 'at-threshold', goal: [915, 490],
    feet: {left:[970,450], right:[970,505]}, obstacles: [{box:[120,800,908,985]}]};
  const choice = {successClaim: true};
  assert.equal(canCrossThreshold(track, scene, choice), true);
  assert.equal(canCrossThreshold(track, scene, {successClaim: false}), false);
  assert.equal(canCrossThreshold(track, {...scene, obstacles:[{box:[750,450,950,515]}]}, choice), false);
  assert.equal(canCrossThreshold({...track, forwardAt:820}, scene, choice), false);
});
