const {test} = require('node:test');
const assert = require('node:assert/strict');

test('ambiguous player identity holds navigation even when the visible box looks valid', async () => {
  const { inspectRoom } = await import('../apps/world/rehearsal/live-perception.mjs');
  async function see(playerCount,playerMatch=true) {
    const scene = {
      playerCount, playerMatch, shoulderView:'rear-right', aisleHeading:'diagonal-right', robotVisible: true, feetVisible: false, left: [0,0], right: [0,0],
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
  assert.equal((await see(1)).aisleHeading,'diagonal-right');
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
  const feet={left:[911,183],right:[920,248]};
  assert.equal(view.robotBox,undefined);
  const bodyBox=[350,200,920,370];
  const measured=fromShoulderView({...scene,feet,feetVisible:true,bodyBox},[1000,220]);
  assert.deepEqual(measured.robotBox,bodyBox,'the Brain needs the observed width for its small-player hold');
  assert.deepEqual(measured.feet,feet);
  assert.equal(measured.feetEstimated,false);
  assert.deepEqual(view.goal,scene.goal);
  assert.deepEqual(view.obstacles[0].point,[626,536]);
  assert.equal(fromShoulderView({...scene,goal:undefined},[1000,220]).goal,undefined);
});

test('each live player compares its own last frame and sends its chosen movement to Brain', async () => {
  const {inspectRoom} = await import('../apps/world/rehearsal/live-perception.mjs');
  const frames = [];
  const ai = {models:{generateContent:async ({contents}) => {
    frames.push(contents[0].parts.filter(p=>p.inlineData).map(p=>p.inlineData.data));
    return {text:JSON.stringify({playerCount:1, playerMatch:true, robotVisible:true, shoulderView:'rear-right', aisleHeading:'diagonal-right',
      bodyBox:[291,54,1000,396],upperBodyBox:[291,54,888,382],obstacles:[{label:'barrier',relation:'crossing',box:[700,450,790,560],solid:true}],
      intent:'step_right', change:'A barrier crossed the aisle',reason:'Clear floor to my right',avoiding:true,target:[760,610]})};
  }}};
  await inspectRoom(ai,'first',undefined,'reference');
  const scene = await inspectRoom(ai,'next',undefined,'reference');
  assert.deepEqual(frames, [['reference','first'],['reference','first','next']]);
  assert.equal(scene.move.intent,'step_right');
  assert.equal(scene.move.avoiding,true);
  assert.equal(scene.obstacles[0].solid,true);
});

test('ER2 supplies independent floor-contact geometry and missing or implausible bases remain unknown',async()=>{
  const {inspectRoom}=await import('../apps/world/rehearsal/live-perception.mjs');
  const full=[351,344,929,502], base=[895,388,929,486];
  const response={playerCount:1,playerMatch:true,robotVisible:true,shoulderView:'rear-right',feetVisible:true,
    bodyBox:[372,194,969,411],left:[862,260],right:[912,305],ahead:[645,480],
    obstacles:[base,[],full].map((floorBox,i)=>({label:'object '+i,box:full,floorBox,solid:true,relation:'ordinary'}))};
  const frame=await inspectRoom({models:{generateContent:async request=>{
    const schema=request.config.responseJsonSchema.properties.obstacles.items;
    assert.ok(schema.required.includes('floorBox'));
    assert.match(request.contents[0].parts.map(p=>p.text??'').join(' '),/underside of each boot sole/i);
    return {text:JSON.stringify(response)};
  }}},'recorded');
  assert.deepEqual(frame.obstacles.map(o=>o.floorBox),[base,null,null]);
  assert.deepEqual(frame.obstacles[0].point,[912,437]);
});
