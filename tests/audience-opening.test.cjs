const test = require('node:test');
const assert = require('node:assert/strict');

test('the audience can see a diagonal path beyond one foreground robot', async () => {
  const {audienceCanSeeApproach} = await import('../apps/world/rehearsal/seed-review.mjs');
  const shot = {playerCount:1, view:'right-shoulder', routeVisible:true, diagonal:true, standingOnFloor:true, bodyBox:[342,65,961,355]};
  assert.equal(audienceCanSeeApproach(shot), true);
  for (const change of [
    {playerCount:2}, {routeVisible:false}, {diagonal:false}, {standingOnFloor:false}, {view:'other'},
    {bodyBox:[290,55,999,435]}, {bodyBox:[490,350,938,521]},
    {bodyBox:[330,590,970,900]}, {bodyBox:[340,66,480,354]}, {bodyBox:null},
  ]) assert.equal(audienceCanSeeApproach({...shot,...change}), false);
});

test('a centered source leaves a diagonal route while an aligned one keeps its full frame', async () => {
  const {openingCrop} = await import('../apps/world/rehearsal/look.mjs');
  for (const point of [{x:.45,y:.49},{x:.72,y:.38}]) {
    const crop = openingCrop(point);
    assert.ok(Math.abs((point.x-crop.x)/crop.scale - .72)<1e-6);
    assert.ok(Math.abs((point.y-crop.y)/crop.scale - .38)<1e-6);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x+crop.scale <= 1 && crop.y+crop.scale <= 1);
    if (point.x === .72) assert.equal(crop.scale,1);
  }
});
