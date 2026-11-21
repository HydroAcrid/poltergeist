const test = require('node:test');
const assert = require('node:assert/strict');
const lighting = import('../apps/world/rehearsal/look.mjs');

test('bright venues dim more than dark venues without erasing the floor', async () => {
  const { dimmingFor } = await lighting;
  assert.ok(dimmingFor(20) < 0.05);
  assert.ok(dimmingFor(120) > dimmingFor(60));
  assert.ok(dimmingFor(240) > 0.3 && dimmingFor(240) < 0.5);
});

test('the opening photo stays ungraded and entering the world enables the grade', async () => {
  const { createHallwayLighting } = await lighting;
  const fill = [];
  const gradient = { addColorStop(){} };
  const ctx = { canvas:{}, createLinearGradient:()=>gradient, createRadialGradient:()=>gradient,
    save(){}, restore(){}, fillRect(){fill.push([this.globalCompositeOperation,this.globalAlpha]);} };
  const doc=global.document;
  try {
    global.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(24*14*4).fill(180)})})})};
    const grade=createHallwayLighting(ctx,1280,720);
    grade(0,1000);
    assert.deepEqual(fill,[]);
    grade(1,2000);
    assert.equal(fill[0][0],'multiply');
    assert.equal(fill[0][1],(await lighting).dimmingFor(180));
  }finally{if(doc===undefined)delete global.document;else global.document=doc;}
});
