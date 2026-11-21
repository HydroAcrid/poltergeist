const test = require('node:test');
const assert = require('node:assert/strict');

test('review rejects a paper sighting for a windup penguin, stale results and an unmoving camera candidate', async () => {
  const { reviewRehearsal } = await import('../scripts/review-rehearsal.mjs');
  const events = [1, 48, 95].map(observed => ({
    observed, observedAt: 1000 + observed,
    scene: { visible: true, playerCount: 1, playerMatch:true, shoulderView:'rear-right',aisleHeading:'diagonal-right', bodyBox: [340,65,930,355],
      rightFloorVisible: true, obstacles: [{label: 'windup penguin'}] },
  }));
  const session = {episodeId:'round-a', terminal:'completed', frames:119, events};
  const outcome = {id:'round-a', live:true, props:[{acked:true, name:'Windup penguins', seenAt:1048, confirmedFrame:95}]};
  assert.match(reviewRehearsal(session, outcome).blockers.join(' '), /never sent a forward/);
  events.push({action:'Player applied W'});
  assert.deepEqual(reviewRehearsal(session, outcome).blockers, []);
  events[1].scene.obstacles = [{label:'loose papers'}];
  assert.match(reviewRehearsal(session, outcome).blockers.join(' '), /first audience sighting/);
  assert.match(reviewRehearsal(session, {...outcome, id:'round-b'}).blockers.join(' '), /matching round ID/);
});
