import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import jpeg from "jpeg-js";
import {
  cameraStep,
  characterInstruction,
  createNativeFollow,
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
    visible: true,
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
    [6, [15, 205, 715, 325], "arrow_up"],
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
  tracker.observe(sighting([435, 205, 820, 325]), 1);
  assert.equal(tracker.permits("W"), true);
  tracker.push(image, 6);
  tracker.observe({ visible: false }, 6);
  tracker.observe(sighting([435, 205, 820, 325]), 1);
  assert.equal(tracker.permits("W"), false);
  assert.equal(tracker.correction(2000), null);
  tracker.push(image, 11);
  tracker.observe(sighting([435, 205, 820, 325]), 11);
  assert.equal(tracker.permits("W"), true);
});

test("low-confidence pixels release a held camera key and stop active robot travel before ER2 reports loss", async () => {
  const tracker = createNativeFollow();
  tracker.push(uniform(0), 1);
  tracker.observe(sighting([435, 205, 820, 325]), 1);
  tracker.push(uniform(255), 6);
  const lock = tracker.status();
  assert.equal(lock.known, false);
  assert.equal(lock.lost, false);
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
  tracker.observe({visible:true,bodyBox:[290,55,1000,435],upperBodyBox:[290,75,840,355],feetVisible:false},1);
  assert.equal(tracker.permits('W'),true);
  assert.equal(tracker.status().scale,1);
  assert.equal(tracker.correction(1000),null);
  tracker.push(image,6);
  tracker.observe({visible:true,bodyBox:[290,55,1000,540],upperBodyBox:[290,75,840,355],feetVisible:false},6);
  assert.equal(tracker.status().rangeTrend,false,'turning the flashlight alone must not change chase distance');
  tracker.push(image,11);
  tracker.observe({visible:true,feetVisible:false},11);
  assert.equal(tracker.permits('W'),false);
});
