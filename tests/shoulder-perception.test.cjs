const {test} = require('node:test');
const assert = require('node:assert/strict');

test('ambiguous player identity holds navigation even when the visible box looks valid', async () => {
  const { inspectRoom } = await import('../apps/world/rehearsal/live-perception.mjs');
  async function see(playerCount,playerMatch=true) {
    const scene = {
      playerCount, playerMatch, shoulderView:'rear-right', robotVisible: true, feetVisible: false, left: [0,0], right: [0,0],
      upperBodyBox: [285,45,872,375], bodyBox: [280,40,1000,420], obstacles: [],
    };
    return inspectRoom({models: {generateContent: async request => {
      const parts=request.contents[0].parts;
      assert.deepEqual(parts.filter(part=>part.inlineData).map(part=>part.inlineData.data),['canonical','live-frame']);
      return {text:JSON.stringify(scene)};
    }}}, 'live-frame', undefined, 'canonical');
  }
  assert.equal((await see(2)).visible, false);
  assert.equal((await see(1)).visible, true);
  assert.equal((await see(0)).visible, false);
  assert.equal((await see(1,false)).visible, false);
});

test('the shoulder pilot keeps native exit and obstacle coordinates and marks hidden feet as estimated', async () => {
  const {fromShoulderView} = await import('../apps/world/rehearsal/trail-view.mjs');
  const scene = {goal:[477,717], ahead:[650,595], pose:'upright',
    obstacles:[{box:[550,481,701,590],point:[701,536]}]};
  const view = fromShoulderView(scene,[1000,220]);
  assert.deepEqual(view.feet,{left:[1000,205],right:[1000,235]});
  assert.equal(view.feetEstimated, true);
  assert.deepEqual(view.goal,scene.goal);
  assert.deepEqual(view.obstacles[0].point,[626,536]);
  assert.equal(fromShoulderView({...scene,goal:undefined},[1000,220]).goal,undefined);
});
