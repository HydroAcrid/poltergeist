const test = require('node:test');
const assert = require('node:assert/strict');
const render = import('../apps/world/rehearsal/veil.mjs');

function recordingContext() {
  const fills = [];
  const gradient = {addColorStop() {}};
  return {fills, globalAlpha:1, save() {},restore() {},
    createRadialGradient() {return gradient;},createLinearGradient() {return gradient;},
    fillRect(...bounds) {fills.push({bounds,alpha:this.globalAlpha,style:this.fillStyle});},
  };
}
test('the chapter boundary covers the whole frame even for reduced motion', async () => {
  const {hallwayBlackout} = await render;
  for (const reduced of [true,false]) {
    const context = recordingContext();
    hallwayBlackout(context,1280,720,1,'hold',reduced);
    assert.deepEqual(context.fills,[{bounds:[0,0,1280,720],alpha:1,style:'#020405'}]);
    hallwayBlackout(context,1280,720,0,'open',reduced);
    assert.equal(context.fills.length,1);
  }
});
test('reduced motion dims evenly and continuously without pulsing light', async () => {
  const {hallwayBlackout} = await render;
  let prior=0;
  for (const amount of [.12,.25,.5,.75,.9]) {
    const ctx=recordingContext();
    hallwayBlackout(ctx,720,405,amount,'close',true);
    assert.equal(ctx.fills.length,1);
    assert.equal(ctx.fills[0].style,'#020405');
    assert.ok(ctx.fills[0].alpha>prior);
    prior=ctx.fills[0].alpha;
  }
});
test('the practicals visibly dip and recover before the complete blackout', async () => {
  const {hallwayBlackout}=await render;
  const lamp={};
  const read=(amount) => {
    const ctx=recordingContext();
    let lampAlpha=0;
    ctx.drawImage=image=>{ assert.equal(image,lamp); lampAlpha=ctx.globalAlpha; };
    hallwayBlackout(ctx,1280,720,amount,'close',false,lamp);
    return {practical:(1-lampAlpha)*(1-ctx.fills[0].alpha),room:1-ctx.fills[0].alpha};
  };
  const dip=read(.21),recovery=read(.42), late=read(.82);
  assert.ok(dip.practical < .2 && recovery.practical>.75 && late.practical<.3);
  assert.ok(dip.room>.9 && recovery.room>.9);
});
