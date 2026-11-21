const test=require('node:test');
const assert=require('node:assert/strict');
const native=import('../apps/world/painted-door/defensive-pickup.mjs');
const placement=import('../apps/world/rehearsal/placement.mjs');
const hold={action:{key:'NOOP',holdMs:0},decision:{source:'model',intent:'hold'}};
// Geometry and the hold choice are from the archived first bat take, frame 371.
// The newer guard fields below are explicit simulated inference, not a retrospective model result.
const sight={visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',feetVisible:true,
  feet:{left:[835,290],right:[748,613]},bodyBox:[273,196,865,417],upperBodyBox:[273,198,680,345],
  threat:'startling',ahead:[573,490],pose:'upright',guardPose:'none',move:{intent:'hold',guard:'duck',avoiding:true},
  obstacles:[{label:'swarm of bats',box:[0,0,995,994],relation:'crossing',solid:false}]};

test('a tracked crossing can become a bounded native guard only on the current Brain-accepted hold',async()=>{
  const {createPlacementController}=await placement;
  const {guardMatchesView,guardInstruction,createGuardPickup}=await native;
  const r={props:[],fear:0,deadline:60000},wire=[];
  const q=createPlacementController(r,c=>wire.push(c),()=>{});
  q.add('idea','A flock of bats crosses the aisle','Lantern',1000);
  q.observe({...sight,obstacles:[]},1,1010,1100);
  q.acknowledged('idea',1,1300,10);
  q.observe(sight,371,3000,3500);
  assert.equal(r.props[0].confirmedFrame,371);
  assert.equal(q.characterCommand({...hold,decision:{source:'veto',intent:'hold'}},3500),null);
  const command=q.characterCommand(hold,3500);
  assert.deepEqual(command,{reaction:'guard',guard:'duck',encounter:'idea',observed:371});
  assert.equal(q.characterCommand(hold,3501),null);
  const shot=createGuardPickup(24), basis={scene:sight,image:'original native JPEG',observed:371};
  assert.equal(shot.reserve(command,{...basis,observed:370}),false);
  assert.equal(shot.reserve(command,basis),true);
  assert.equal(shot.reserve(command,basis),false);
  assert.equal(shot.basisImage,basis.image);
  const sends=[guardInstruction(command.guard)];
  assert.match(sends[0],/Bend both knees deeply/);
  assert.doesNotMatch(sends[0],/bat|flock/i);
  shot.applied(400,4000);
  const crouch={...sight,guardPose:'duck',bodyBox:[380,196,865,417]};
  assert.equal(shot.observe(crouch,399),null);
  assert.equal(shot.observe({...crouch,playerCount:2},420),null);
  assert.equal(shot.observe({...crouch,bodyBox:sight.bodyBox},426),null);
  assert.equal(shot.observe({...crouch,feet:{left:[600,400],right:[748,613]}},432),null);
  const receipt=shot.observe(crouch,438);
  assert.deepEqual(receipt,{encounter:'idea',guard:'duck',basis:371,appliedFrame:400,checkedFrame:438});
  q.observe(crouch,438,5800,6050,false,receipt);
  assert.equal(r.props[0].observedReaction,'defend');
  assert.equal(r.fear,0);
  assert.equal(shot.observe(crouch,460),null);
  await shot.advance(459,6550,x=>sends.push(x));
  assert.equal(sends.length,1);
  await shot.advance(507,8500,x=>sends.push(x));
  await shot.advance(508,8540,x=>sends.push(x));
  assert.equal(sends.length,2);
  assert.match(sends[1],/straighten its knees/);
  assert.equal(shot.active,false);
  // Later archived frame 439 contained ordinary forward travel with no crossing effect.
  assert.equal(guardMatchesView({...sight,threat:'ordinary',move:{intent:'walk'}},null),false);
  assert.equal(guardMatchesView(sight,{...sight.obstacles[0],box:[800,0,995,994]}),false);
  assert.equal(guardMatchesView({...sight,move:{intent:'step_right',guard:'duck',avoiding:true}},sight.obstacles[0]),false);
  assert.match(guardInstruction('shield'),/raise the free left forearm/);
  assert.match(guardInstruction('recoil'),/Recoil once/);
  assert.equal(guardInstruction('other'),null);
});

test('an unresolved pickup expires without awarding motion or directing a different actor',async()=>{
  const {createGuardPickup}=await native;
  const shot=createGuardPickup(24), send=()=>assert.fail('identity was lost');
  shot.reserve({reaction:'guard',guard:'duck',encounter:'p',observed:30},{scene:sight,image:'before',observed:30});
  shot.applied(32,0);
  assert.equal(shot.tail(4000,8000),4000);
  assert.equal(shot.observe({...sight,visible:false},110),null);
  await shot.advance(140,5000,send);
  assert.equal(shot.active,true);
  await shot.advance(230,8000,send);
  assert.equal(shot.active,false);
});

test('buffered admission for a duck requires native evidence and independent pixel agreement, and gives zero fear',async()=>{
  const {reviewSegment}=await import('../apps/world/rehearsal/segment-review.mjs');
  const {selectReviewFrames,filmedVeto}=await import('../apps/world/rehearsal/filmed-review.mjs');
  const observed=frame=>({frame,visible:true,playerCount:1,shoulderView:'rear-right',feetVisible:true,subjectTracked:true});
  const pick={id:'idea'}, row={id:'idea',delivered:true,visible:true,inPath:true,inPathFrame:20,inPathOffsetMs:800,
    reacted:true,scare:false,reaction:'defend',reactedFrame:90,reactedOffsetMs:3800,
    guardReview:{encounter:'idea',guard:'duck',basis:50,appliedFrame:62,checkedFrame:90}};
  const evidence={observations:[20,50,90,110].map(observed),picks:[row],finalFear:0};
  const clip={evidence,frameCount:120,fps:24,durationMs:5000};
  const plan=selectReviewFrames(evidence,120,24);
  assert.deepEqual(plan.frames,[50,90,120]);
  const result={camera:{argon:true,decisions:.97},events:[{index:1,argon:'defend',decisions:'defend'}]};
  assert.equal(filmedVeto(evidence,result),null);
  assert.match(filmedVeto(evidence,{...result,events:[{index:1,argon:'none',decisions:'defend'}]}),/could not confirm/);
  assert.equal(reviewSegment(clip,[pick],0,false).receipts[0].scareAt,null);
  row.guardReview.checkedFrame=50;
  assert.equal(reviewSegment(clip,[pick],0,false).ok,false);
});

test('an alerted but physically unguarded explorer can perform its chosen recoil, with no credit after the obstacle has left',async()=>{
  const {guardMatchesView,createGuardPickup}=await native;
  const {createPlacementController}=await placement;
  // Actual QA native observation 321, after placement was delivered at 228.
  const detected={visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',feetVisible:true,
    feet:{left:[708,287],right:[711,342]},ahead:[549,497],bodyBox:[223,234,737,420],
    pose:'startled',guardPose:'none',threat:'startling',move:{intent:'hold',guard:'recoil',avoiding:true},
    obstacles:[{label:'swarm of bats',box:[53,298,473,869],relation:'crossing',solid:false}]};
  assert.equal(guardMatchesView(detected,detected.obstacles[0]),true);
  assert.equal(guardMatchesView({...detected,guardPose:'recoil'},detected.obstacles[0]),false);
  assert.equal(guardMatchesView({...detected,pose:'stumbling'},detected.obstacles[0]),false);
  const r={props:[],fear:0,deadline:60000};
  const q=createPlacementController(r,()=>{},()=>{});
  q.add('swarm','A swarm of bats sweeps across the flashlight beam','Ghost',1000);
  q.observe({...detected,obstacles:[],pose:'upright'},156,1100,1300);
  q.acknowledged('swarm',1,1400,228);
  q.observe(detected,321,5000,7700);
  const direction=q.characterCommand(hold,7700);
  assert.deepEqual(direction,{reaction:'guard',guard:'recoil',encounter:'swarm',observed:321});
  assert.equal(r.fear,0);
  const pickup=createGuardPickup(24);
  assert.ok(pickup.reserve(direction,{observed:321,scene:detected,image:'native reference'}));
  pickup.applied(383,7800);
  assert.equal(pickup.observe(detected,400),null,'same unguarded pose is never proof');
  const late={...detected,obstacles:[],guardPose:'recoil'};
  const review=pickup.observe(late,420);
  q.observe(late,420,9200,11000,false,review);
  assert.equal(r.fear,0);assert.equal(r.props[0].reactedAt,undefined);
});
