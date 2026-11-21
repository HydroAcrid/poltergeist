import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import jpeg from "jpeg-js";
import {
  cameraStep,
  characterInstruction,
  createNativeFollow,
  createMoveWindow,
  shoulderStride,
  holdIfUntracked,
  reactionInstruction,
} from "./native-follow.mjs";

const still = {
  grounded: true,
  known: true,
  lost: false,
  x: 0.245,
  h: 0.71,
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
    cameraStep({ ...still, x: 0.1, scale:1.22, vx: -0.06 }).key,
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
  tracker.observe({visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',bodyBox:[290,55,1000,435],upperBodyBox:[290,75,840,355],feetVisible:false},1);
  assert.equal(tracker.permits('W'),true);
  assert.equal(tracker.status().scale,1);
  assert.equal(tracker.correction(1000),null);
  tracker.push(image,6);
  tracker.observe({visible:true,playerCount:1,playerMatch:true,shoulderView:'rear-right',bodyBox:[290,55,1000,540],upperBodyBox:[290,75,840,355],feetVisible:false},6);
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
  assert.equal(tracker.permits('W'),false);
  const pulse=tracker.correction(8000);
  assert.equal(pulse.key,'key_w');
  assert.equal(pulse.reason,'recover shoulder distance');
  assert.equal(pulse.lateralKey,undefined);
  assert.ok(pulse.ms>=95 && pulse.ms<=265);
  assert.equal(tracker.correction(9900),null,'one bounded camera approach per source observation');
  deliver(191,238,[340,190,996,432],{obstacles:[{label:'bench',box:[875,300,1000,590]}]});
  assert.equal(tracker.correction(10500),null,'an obstruction between camera and subject blocks an approach');
  assert.equal(tracker.permits('D'),false);
  deliver(250,298,[325,145,1000,446]);
  assert.equal(tracker.permits('W'),false,'await measured restoration before allowing the actor to advance');
  deliver(310,355,[300,78,1000,416]);
  assert.equal(tracker.permits('W'),true);
  deliver(366,418,[300,78,1000,416],{playerCount:2});
  assert.equal(tracker.permits('W'),false);
  assert.equal(tracker.correction(20000),null);
});
