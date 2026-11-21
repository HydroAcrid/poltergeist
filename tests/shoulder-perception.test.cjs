const {test} = require('node:test');
const assert = require('node:assert/strict');

test('ambiguous player identity holds navigation even when the visible box looks valid', async () => {
  const { inspectRoom } = await import('../apps/world/rehearsal/live-perception.mjs');
  async function see(playerCount) {
    const scene = {
      playerCount, robotVisible: true, feetVisible: false, left: [0,0], right: [0,0],
      upperBodyBox: [285,45,872,375], bodyBox: [280,40,1000,420], obstacles: [],
    };
    return inspectRoom({models: {generateContent: async () => ({text: JSON.stringify(scene)})}}, '');
  }
  assert.equal((await see(2)).visible, false);
  assert.equal((await see(1)).visible, true);
  assert.equal((await see(0)).visible, false);
});
