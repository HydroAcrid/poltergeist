import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createNativeFollow, nativePan } from "./native-follow.mjs";

test("steers the native view toward the robot when it approaches either edge", () => {
  assert.equal(nativePan(0.12, true), "arrow_left");
  assert.equal(nativePan(0.82, true), "arrow_right");
  assert.equal(nativePan(0.34, true), null);
  assert.equal(nativePan(0.95, false, -1), "arrow_left");
});

test("losing the observed robot holds navigation; a new body sighting restores it", () => {
  const tracker = createNativeFollow();
  const jpg = fs.readFileSync(
    new URL("../rehearsal/calibration/forward-before.jpg", import.meta.url),
  );
  tracker.push(jpg, 1);
  tracker.observe({ visible: false }, 1);
  assert.equal(tracker.permits("W"), false);
  tracker.push(jpg, 6);
  tracker.observe(
    {
      visible: true,
      bodyBox: [400, 190, 785, 310],
      feet: { left: [785, 220], right: [785, 280] },
      pose: "upright",
      threat: "ordinary",
      obstacles: [],
    },
    6,
  );
  assert.equal(tracker.permits("W"), true);
  assert.equal(tracker.correction(1000), null);
  tracker.observe({ visible: false }, 1);
  assert.equal(tracker.permits("W"), true);
});

test("a small known subject can trigger one native range correction, only when travel is allowed", () => {
  const tracker = createNativeFollow();
  const jpg = fs.readFileSync(
    new URL("../rehearsal/calibration/forward-before.jpg", import.meta.url),
  );
  tracker.push(jpg, 1);
  tracker.observe(
    {
      visible: true,
      bodyBox: [600, 300, 760, 370],
      feet: { left: [760, 327], right: [760, 343] },
      pose: "upright",
      threat: "ordinary",
      obstacles: [],
    },
    1,
  );
  assert.equal(tracker.correction(1500, false), null);
  assert.equal(tracker.correction(1500, true)?.key, "key_w");
  assert.equal(tracker.correction(4000, true), null);
});

test("tilts once per sighting to bring clipped boots or head back into view", () => {
  const tracker = createNativeFollow();
  const jpg = fs.readFileSync(
    new URL("../rehearsal/calibration/forward-before.jpg", import.meta.url),
  );
  let frame = 1;
  for (const [box, expected] of [
    [[445, 151, 1000, 411], "arrow_down"],
    [[25, 151, 710, 411], "arrow_up"],
    [[200, 151, 880, 411], null],
  ]) {
    tracker.push(jpg, frame);
    tracker.observe({
      visible: true,
      bodyBox: box,
      feet: { left: [box[2], 220], right: [box[2], 300] },
      pose: "upright",
      threat: "ordinary",
      obstacles: [],
    }, frame);
    assert.equal(tracker.correction(frame * 2000, false)?.key ?? null, expected);
    assert.equal(tracker.correction(frame * 2000 + 1000, false), null);
    frame++;
  }
});
