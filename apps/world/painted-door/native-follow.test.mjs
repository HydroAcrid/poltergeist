import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import jpeg from "jpeg-js";
import {
  cameraStep, shoulderFrame,
  characterInstruction,
  createNativeFollow,
  createMoveWindow,
  createPlacementView,
  shoulderStride,
  holdIfUntracked,
  reactionInstruction,
} from "./native-follow.mjs";

const still = {
  grounded: true,
  known: true,
  lost: false,
  x: shoulderFrame.x,
  h: shoulderFrame.height,
  scale:1,
  vx: 0,
  vh: 0,
  top: 0.435,
  bottom: 0.82,
};
const image = fs.readFileSync(
  new URL("../rehearsal/calibration/forward-before.jpg", import.meta.url),
);
function sighting(box) {
  return {
    visible: true, playerCount:1, playerMatch:true, shoulderView:'rear-right',
    bodyBox: box,
    feet: { left: [box[2], box[1]], right: [box[2], box[3]] },
  };
}
function uniform(value) {
  return jpeg.encode({
    width: 112,
    height: 64,
    data: Buffer.alloc(112 * 64 * 4, value),
  }).data;
}

test("keeps a steady native shot for stationary, small or enlarged on-mark subjects", () => {
  for (const scale of [.45,1,1.25]) {
    assert.equal(cameraStep({ ...still, scale }), null);
  }
});

test("lateral truck keeps pace in both directions and never dollies toward the robot", () => {
  for (const direction of [-1, 1]) {
    const x = still.x + 0.075 * direction;
    const step = cameraStep({ ...still, x, vx: 0.13 * direction });
    assert.equal(step.key, direction === 1 ? "key_d" : "key_a");
    const fast = cameraStep({ ...still, x, vx: 0.27 * direction, vh: -0.02 });
    assert.ok(fast.ms > step.ms && fast.ms <= 185);
    assert.equal(
      cameraStep({ ...still, x, vx: -0.13 * direction }),
      null,
      "returning robot needs no counter-pulse",
    );
  }
});

test("a close subject never triggers a forward key; small pan covers an off-mark rest", () => {
  assert.equal(
    cameraStep({ ...still, x: 0.54, scale:1.24, vx: 0.11 }).key,
    "arrow_right",
  );
  assert.equal(
    cameraStep({ ...still, x: 0.06, scale:1.22, vx: -0.06 }).key,
    "arrow_left",
  );
  assert.equal(cameraStep({ ...still, vx:0.06,scale:1.12,vh:0.09 }), null);
  assert.equal(cameraStep({ ...still, x: 0.48, vx: 0 }).key, "arrow_right");
});

test("accepts cropped boots; only a clipped head gets a brief tilt per sighting", () => {
  const tracker = createNativeFollow();
  for (const [frame, box, expected] of [
    [1, [295, 65, 1000, 425], null],
    [6, [15, 65, 1000, 425], "arrow_up"],
  ]) {
    tracker.push(image, frame);
    tracker.observe(sighting(box), frame);
    assert.equal(tracker.correction(1000 * frame, false), null);
    assert.equal(tracker.correction(1000 * frame)?.key ?? null, expected);
    assert.equal(tracker.correction(1000 * frame + 1000), null);
  }
});

test("unseen startup and lost observations stay still; stale observations cannot restart motion", () => {
  const tracker = createNativeFollow();
  tracker.push(image, 1);
  assert.equal(tracker.permits("W"), false);
  assert.equal(tracker.correction(1000), null);
  tracker.observe(sighting([290, 55, 1000, 435]), 1);
  assert.equal(tracker.permits("W"), true);
  tracker.push(image, 6);
  tracker.observe({ visible: false }, 6);
  tracker.observe(sighting([290, 55, 1000, 435]), 1);
  assert.equal(tracker.permits("W"), false);
  assert.equal(tracker.correction(2000), null);
  tracker.push(image, 11);
  tracker.observe(sighting([290, 55, 1000, 435]), 11);
  assert.equal(tracker.permits("W"), false, "one sighting cannot reacquire identity");
  tracker.push(image, 16);
  tracker.observe(sighting([290, 55, 1000, 435]), 16);
  assert.equal(tracker.permits("W"), true);
});

test("low-confidence pixels release a held camera key and stop active robot travel before ER2 reports loss", async () => {
  const tracker = createNativeFollow();
  tracker.push(uniform(0), 1);
  tracker.observe(sighting([290, 55, 1000, 435]), 1);
  tracker.push(uniform(255), 6);
  const lock = tracker.status();
  assert.equal(lock.known, false);
  assert.equal(lock.lost, true);
  let heldKey = "key_d",
    walking = true;
  const actions = [];
  const release = () => {
    if (heldKey) actions.push("release " + heldKey);
    heldKey = null;
  };
  const stop = () => {
    if (walking) actions.push("stop strides");
    walking = false;
  };
  assert.equal(await holdIfUntracked(lock, release, stop), true);
  assert.equal(await holdIfUntracked(lock, release, stop), true);
  assert.deepEqual(actions, ["release key_d", "stop strides"]);
  assert.equal(tracker.correction(1000), null);
  assert.equal(tracker.permits("D"), false);
});

test("navigation controls cue the avatar once; avoid and notice preserve the intended side", () => {
  for (const [key, side] of [
    ["A", "left"],
    ["D", "right"],
  ]) {
    assert.match(
      characterInstruction({ key, reaction: "avoid", toward: side }),
      new RegExp("exactly one visible sidestep to its " + side),
    );
    assert.match(
      reactionInstruction({ reaction: "notice", toward: side }),
      new RegExp("both boots planted.*glances to its " + side),
    );
  }
  assert.match(characterInstruction({ key: "W" }), /two small walking strides/);
  assert.match(characterInstruction({ key: "S" }), /one small step back/);
  assert.match(reactionInstruction({ reaction: "startle" }), /short hop back/);
  assert.equal(reactionInstruction({ reaction: "notice", toward: "up" }), null);
  assert.equal(
    reactionInstruction({ reaction: "avoid", toward: "left" }),
    null,
  );
  assert.equal(characterInstruction({ key: "key_w" }), null);
});

test("bounded depth component needs both independently measured shrinkage and fresh local shrinkage", () => {
  const receding = {
    ...still,
    scale:.65,
    vx: 0.11,
    x: 0.35,
    rangeTrend: true,
    localRatio: 0.92,
    clearLane: true,
  };
  const correction = cameraStep(receding);
  assert.equal(correction.key, "key_w");
  assert.equal(correction.lateralKey, "key_d");
  assert.ok(correction.ms >=145 && correction.ms <=340);
  for (const override of [
    { known: false },
    { lost: true },
    { grounded: false },
    { scale:1 },
    { rangeTrend: false },
    { localRatio: null },
    { localRatio: 1 },
    { localRatio: 1.16 },
    { clearLane: false },
  ]) {
    assert.notEqual(cameraStep({ ...receding, ...override })?.key, "key_w");
  }
  assert.equal(cameraStep({ ...receding, scale:1.30,vx:0,x:.245 }), null);
});

test('upper body remains a valid camera anchor when both boots fall below the frame',()=>{
  const tracker=createNativeFollow();
  tracker.push(image,1);
  tracker.observe({visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',bodyBox:[290,55,1000,435],upperBodyBox:[340,85,755,300],feetVisible:false},1);
  assert.equal(tracker.permits('W'),true);
  assert.equal(tracker.status().scale,1);
  assert.equal(tracker.correction(1000),null);
  tracker.push(image,6);
  tracker.observe({visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',bodyBox:[290,55,1000,540],upperBodyBox:[340,85,755,300],feetVisible:false},6);
  assert.equal(tracker.status().rangeTrend,false,'turning the flashlight alone must not change chase distance');
  tracker.push(image,11);
  tracker.observe({visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',feetVisible:false},11);
  assert.equal(tracker.permits('W'),false);
});

test('penguin encounter frame cadence cannot queue contradictory or repeated movement', () => {
  const window = createMoveWindow(24);
  window.start(0);
  const accept = (key, observed, received, at) => window.accept({key, observed}, {...still, observed}, received, at);
  assert.equal(accept('D', 123, 149, 8250), true);
  // At 8.25 seconds the generated stream may already include frame 199.
  for (const [key, source, delivered, at] of [
    ['A',151,153,11000], ['ArrowLeft',154,156,14000], ['A',158,161,18000],
    ['A',180,208,26000], ['A',213,227,29000],
  ]) assert.equal(accept(key,source,delivered,at),false);
  assert.equal(accept('A',230,234,32000),false, 'late delivery cannot move from stale pixels');
  assert.equal(accept('A',236,239,35000),false);
  assert.equal(accept('W',779,784,32500),true, 'a fresh frame resumes movement');
  assert.equal(window.accept({key:'W',observed:242}, {...still,observed:256}, 900,36000),false);
});
test('committed forward walk can pace a centered shoulder before depth drift', () => {
  const subject = {...still,clearLane:true};
  assert.equal(shoulderStride(subject).key, 'key_w');
  for (const override of [{clearLane:false},{scale:1.25},{x:.65},{lost:true},{known:false}]) {
    assert.equal(shoulderStride({...subject,...override}),null);
  }
});

test('duplicate, distant replacement and sudden identity jumps cannot restart the camera or actor', () => {
  const tracker = createNativeFollow();
  const at = (n, scene) => { tracker.push(image,n); tracker.observe(scene,n); return tracker.permits('W'); };
  const opening = sighting([292,54,1000,432]);
  const distant = sighting([413,575,640,675]);
  assert.equal(at(1,distant),false);
  assert.equal(at(6,opening),false);
  assert.equal(at(11,opening),true);
  assert.equal(at(16,{...opening,playerCount:2}),false);
  assert.equal(tracker.status().holdReason,'duplicate players');
  assert.equal(tracker.correction(100000),null);
  assert.equal(at(21,opening),false);
  assert.equal(at(26,opening),true);
  assert.equal(at(31,distant),false);
  assert.equal(tracker.status().holdReason,'discontinuous subject');
  assert.equal(at(36,{...opening,playerMatch:false}),false);
  assert.equal(at(41,{...opening,shoulderView:'other'}),false);
  assert.equal(at(46,opening),false);
  assert.equal(at(51,opening),true);
  tracker.push(image,151);
  assert.equal(tracker.permits('W'),false);
  tracker.observe(opening,52);
  assert.equal(tracker.permits('W'),false);
});

test('hosted return cadence retains one semantic actor through optical loss and paces only the camera until reframed',()=>{
  const tracker=createNativeFollow();
  const dark=uniform(0), light=uniform(255);
  let next=1;
  function deliver(observed, received, box, overrides={}) {
    for(;next<=received;next+=5)
      tracker.push(next<60 || next%10===1 ? dark : light,next);
    tracker.observe({...sighting(box),rightFloorVisible:true,pose:'upright',threat:'ordinary',
      ahead:[731,529],obstacles:[],...overrides},observed);
  }
  // The first three pairs and body boxes are native ER2 source/return frames
  // from the hosted rehearsal. Alternating pixels simulate an unreliable patch.
  deliver(1,59,[291,54,1000,396]);
  assert.equal(tracker.permits('W'),true);
  deliver(71,123,[299,109,1000,432]);
  assert.equal(tracker.permits('W'),true,'a failed patch must not delete the preceding semantic match');
  deliver(135,180,[324,157,1000,417]);
  assert.equal(tracker.permits('W'),true,'the new wider shot accepts the previous medium view');
  deliver(191,238,[340,190,996,432]);
  assert.equal(tracker.permits('W'),false);
  const pulse=tracker.correction(10000);
  assert.equal(pulse.key,'key_w');
  assert.equal(pulse.reason,'recover shoulder distance');
  assert.equal(pulse.lateralKey,undefined);
  assert.equal(pulse.ms,4000,'recovery uses a finite watchdog while native frames monitor the held key');
  assert.equal(tracker.verified(191),true,'the distant verified actor remains visible to placement');
  assert.equal(tracker.permitsPlacement(191),true);
  assert.equal(tracker.permitsPlacement(135),false);
  assert.equal(tracker.correction(11900),null,'one bounded camera approach per source observation');
  deliver(250,298,[351,208,981,438],{obstacles:[{label:'bench',box:[875,300,1000,590]}]});
  assert.equal(tracker.correction(12800),null,'an obstruction between camera and subject blocks an approach');
  assert.equal(tracker.permits('D'),false);
  deliver(310,355,[350,190,970,438]);
  assert.equal(tracker.permits('W'),false,'await measured restoration before allowing the actor to advance');
  deliver(366,418,[345,93,946,378]);
  assert.equal(tracker.permits('W'),true,'resume at the new medium shot, well before the original 38% width');
  deliver(429,477,[345,93,946,378],{playerCount:2});
  assert.equal(tracker.permits('W'),false);
  assert.equal(tracker.correction(20000),null);
});

test('placement reserves a stationary post-stop source through the host decision and native send',()=>{
  const view=createPlacementView(), clock=createMoveWindow(24);
  clock.start(1000);
  // The cue in the second hosted run stopped motion around native frame 207.
  view.pause(9500);
  view.moved(clock.settledFrame(207,9500));
  assert.equal(view.held(12700),true,'a three-second vision call cannot expire the queued placement');
  assert.equal(view.ready(170,true,false),false,'the result returned after the stop but its pixels predate it');
  assert.equal(view.ready(245,true,true),false);
  assert.equal(view.ready(245,true,false),true);
  view.offered(13000);
  assert.equal(view.held(14300),true);
  assert.equal(view.reserve(245,true,false),true);
  assert.equal(view.held(16900),true,'the camera remains fixed until the provider send completes');
  assert.equal(view.reserve(245,true,false),false);
  view.finish(17000);
  assert.equal(view.held(18000),false);
  view.moved(260);
  assert.equal(view.reserve(245,true,false),false,'a new physical movement invalidates the target');
  view.pause(20000);
  assert.equal(view.held(49000),false,'failed or missing vision cannot hold a game indefinitely');
});

test('native texture expansion releases recovery before a new semantic result grants actor movement',()=>{
  const tracker=createNativeFollow();
  function patternedFrame(scale) {
    const w=112,h=64,data=Buffer.alloc(w*h*4,255);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const dx=(x-29)/scale,dy=(y-41)/scale,i=(y*w+x)*4;
      for(let c=0;c<3;c++)
        data[i+c]=120+45*Math.sin(dx*.65+c)+40*Math.cos(dy*.55+c)+34*Math.cos(dx*.33+dy*.24+c);
    }
    return jpeg.encode({width:w,height:h,data},92).data;
  }
  const initial=patternedFrame(1);
  const scene=(bodyBox)=>({...sighting(bodyBox),rightFloorVisible:true,pose:'upright',threat:'ordinary',ahead:[720,510],obstacles:[]});
  tracker.push(initial,1);
  tracker.observe(scene([340,75,930,365]),1);
  for(let frame=6;frame<=51;frame+=5) tracker.push(initial,frame);
  tracker.observe(scene([315,156,970,360]),51);
  assert.equal(tracker.status().cameraRecovery,true);
  for(let frame=56;frame<=126;frame+=5)
    tracker.push(patternedFrame(1+(frame-51)*.006),frame);
  const lock=tracker.status();
  assert.ok(lock.known && lock.opticalWidth>=shoulderFrame.width*.88 && lock.opticalWidth<.38*.88,'native subject scale should grow back into the shoulder crop');
  assert.equal(lock.cameraRecovery,false,'stop the native forward key immediately at restored scale');
  assert.equal(tracker.permits('W'),false,'only a fresh semantic reading may restart the actor');
});

test('a grounded rear-right diagonal stays steady; two head-on aisle sightings permit a bounded clear orbit',()=>{
  const tracker=createNativeFollow();
  const scene=(heading,obstacles=[])=>({...sighting([340,65,930,355]),rightFloorVisible:true,feetVisible:true,
    ahead:[710,505],pose:'upright',threat:'ordinary',aisleHeading:heading,obstacles});
  const read=(frame,heading,obstacles)=>{tracker.push(image,frame);tracker.observe(scene(heading,obstacles),frame);return tracker.correction(frame*100);};
  assert.equal(read(1,'diagonal-right'),null);
  assert.equal(read(11,'head-on'),null);
  const step=read(21,'head-on');
  assert.deepEqual([step.key,step.lateralKey,step.reason],['arrow_left','key_d','restore rear-right diagonal']);
  assert.equal(read(31,'head-on',[{box:[510,545,970,810]}]),null,'a chair beside the camera blocks the sideways motion');
  assert.equal(read(41,'diagonal-right'),null);
});

test('native movement holds report the exact freshness or tracking constraint and permit a scoped wide sidestep only on new pixels', () => {
  const window = createMoveWindow(24);
  const key = {key:'D',observed:310};
  const wide = {...still,observed:310,distanceHeld:true,holdReason:'recovering shoulder distance'};
  assert.equal(window.reason(key,wide,310,12780), 'No native frame yet');
  window.start(0);
  assert.equal(window.reason(key,wide,379,15800), 'recovering shoulder distance');
  assert.equal(window.reason(key,wide,379,15800,true), null);
  assert.equal(window.accept(key,wide,379,15800,true),true);
  assert.equal(window.reason(key,wide,379,15800,true),'Waiting for a frame after the previous action');
  const newRead={key:'D',observed:410};
  assert.equal(window.reason(newRead,{...wide,observed:411},450,19000,true),'Decision belongs to another observation');
  assert.equal(window.reason(newRead,{...wide,observed:410},550,23000,true),'Observation is over four seconds behind the native view');
  assert.equal(window.accept(newRead,{...wide,observed:410,lost:true},450,19000,true),false);
});

test('the recorded approaching boots release the camera before they leave the bottom of the frame', () => {
  const tracker=createNativeFollow();
  // Successive body boxes from the second hosted hallway take, last clear feet at 266.
  const boxes=[[270,237,838,434],[266,180,924,401],[259,114,995,381]];
  for (const [index,box] of boxes.entries()) {
    const frame=index*60+1;
    tracker.push(image,frame);
    tracker.observe({...sighting(box),rightFloorVisible:true,feetVisible:index<2,
      ahead:[600,680],pose:'upright',threat:'ordinary',obstacles:[]},frame);
    if (index===0) continue;
    assert.equal(tracker.status().approachingEdge,true);
    assert.equal(tracker.status().cameraRecovery,false);
    assert.equal(shoulderStride({...still,clearLane:true,approachingEdge:tracker.status().approachingEdge}),null);
  }
});

test('a continuation acquires the actual filmed subject in two grounded reads and keeps player travel held while wide',()=>{
  const seed=fs.readFileSync(new URL('../rehearsal/venue-prologue/encounter-final.jpg',import.meta.url));
  const first=fs.readFileSync(new URL('../rehearsal/calibration/continuation-1.jpg',import.meta.url));
  const second=fs.readFileSync(new URL('../rehearsal/calibration/continuation-65.jpg',import.meta.url));
  const scene=(body,upper)=>({...sighting(body),upperBodyBox:upper,feetVisible:true,rightFloorVisible:true,
    aisleHeading:'diagonal-right',pose:'upright',threat:'ordinary',ahead:[568,514],obstacles:[]});
  const a=scene([242,270,825,471],[242,270,601,470]);
  const b=scene([248,272,810,473],[248,272,593,408]);
  function observe(f,picture,number,s) { f.push(picture,number);f.observe(s,number); }
  const opening=createNativeFollow();
  observe(opening,first,1,a);observe(opening,second,65,b);
  assert.equal(opening.verified(65),false,'a new world still requires its designed opening composition');
  const native=createNativeFollow({continuationSeed:seed});
  observe(native,first,1,a);
  assert.equal(native.verified(1),false);
  observe(native,second,65,b);
  assert.equal(native.verified(65),true);
  assert.equal(native.permitsPlacement(65),true);
  assert.equal(native.permits('W'),false);
  assert.equal(native.correction(0).reason,'recover shoulder distance');
  observe(native,second,125,{...b,playerCount:2});
  assert.equal(native.permitsPlacement(125),false);
  assert.equal(native.correction(5000),null);
  const stranger=scene([248,68,810,268],[248,68,593,204]);
  observe(native,second,150,stranger);
  assert.equal(native.verified(150),false,'the nominal position cannot select a different figure after ambiguity');
  observe(native,second,155,b);
  assert.equal(native.verified(155),false,'returning to the filmed subject requires confirmation');
  observe(native,second,190,b);
  assert.equal(native.verified(190),true);

  const changed=jpeg.decode(first);
  // Preserve the room and change just the independently measured backpack region.
  for(let y=Math.floor(.24*changed.height);y<.62*changed.height;y++) for(let x=Math.floor(.27*changed.width);x<.48*changed.width;x++) {
    const i=4*(y*changed.width+x);changed.data.set([235,235,235,255],i);
  }
  const mismatch=jpeg.encode(changed,90).data;
  const replaced=createNativeFollow({continuationSeed:seed});
  observe(replaced,mismatch,1,a);observe(replaced,mismatch,65,b);
  assert.equal(replaced.verified(65),false,'a stationary background cannot authenticate a replaced player');
});

test('a brief shoulder-angle disagreement can retain location but needs two new right-shoulder reads before inputs',()=>{
  const seed=fs.readFileSync(new URL('../rehearsal/venue-prologue/encounter-final.jpg',import.meta.url));
  const first=fs.readFileSync(new URL('../rehearsal/calibration/continuation-1.jpg',import.meta.url));
  // Change the pixels after the initial sighting. The original backpack cannot
  // be rematched by appearance once the explorer turns or the beam moves.
  const changed=uniform(75);
  const see=(box,upper,angle='rear-right')=>({...sighting(box),upperBodyBox:upper,feetVisible:true,
    shoulderView:angle,aisleHeading:'diagonal-right',rightFloorVisible:true,pose:'upright',threat:'ordinary',ahead:[570,520],obstacles:[]});
  const start=see([242,270,823,472],[242,270,601,470]);
  const side=see([251,273,812,476],[251,273,590,409],'other');
  const back=see([251,273,795,458],[251,273,585,414]);
  const again=see([255,263,788,443],[255,263,574,397]);
  function attempt(intermediate,gap=145){
    const f=createNativeFollow({continuationSeed:seed});
    const observe=(n,s,img=changed)=>{f.push(img,n);f.observe(s,n)};
    observe(1,start,first);observe(76,intermediate);
    assert.equal(f.verified(76),false);
    assert.equal(f.permitsPlacement(76),false);
    assert.equal(f.permits('W'),false);
    assert.equal(f.correction(2500),null);
    observe(gap,back);
    assert.equal(f.verified(gap),false);
    assert.equal(f.permitsPlacement(gap),false);
    observe(gap+65,again);
    return f;
  }
  const restored=attempt(side);
  assert.equal(restored.verified(210),true);
  assert.equal(restored.status().cameraRecovery,true);
  assert.equal(restored.permits('W'),false,'a recovered but wide frame still restricts forward travel');
  assert.equal(attempt({...side,playerCount:2}).verified(210),false);
  assert.equal(attempt({...side,playerMatch:false}).verified(210),false);
  assert.equal(attempt({...side,feetVisible:false}).verified(210),false);
  assert.equal(attempt({...side,bodyBox:[210,575,818,778]}).verified(210),false);
  assert.equal(attempt(side,260).verified(325),false);
});
