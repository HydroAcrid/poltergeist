// Composition of the hallway seed in normalized, uncropped native coordinates.
import { shoulderFrame } from '../rehearsal/look.mjs';
export { shoulderFrame };

export function validBodyBox(b) {
  return Array.isArray(b) && b.length===4 && b.every(n=>Number.isFinite(n)&&n>=0&&n<=1000) && b[0]<b[2] && b[1]<b[3];
}

export function assessFraming(events, totalFrames) {
  const samples = events.filter((event) => event.scene && Number.isInteger(event.observed));
  const result = {status: 'insufficient', samples: samples.length, firstHeight: null, lastHeight: null, firstWidth:null, lastWidth:null, issues: []};
  let priorFrame = 0;
  let incomplete = samples.length < 3 || !totalFrames;
  for (const {scene, observed} of samples) {
    // Frames are 24 fps. A gap longer than four seconds leaves this stretch unverified.
    if (observed <= priorFrame || observed - priorFrame > 96) incomplete = true;
    priorFrame = observed;
    const box = scene.bodyBox;
    if (!scene.visible || !validBodyBox(box)) {
      incomplete = true;
      continue;
    }
    const [top, left, bottom, right] = box;
    const height = (bottom - top) / 1000;
    const width=(right-left)/1000;
    const centre = (left + right) / 2000;
    if (height <= 0 || left >= right) { incomplete = true; continue; }
    result.firstWidth ??= width;
    result.lastWidth=width;
    result.firstHeight ??= height;
    result.lastHeight = height;
    const faults = [];
    if (width < shoulderFrame.width*.78) faults.push('too distant');
    if (width > shoulderFrame.width*1.22) faults.push('too close');
    if (Math.abs(centre - shoulderFrame.x) > .115) faults.push('left the shoulder framing');
    if (top < 15 || left < 12 || right > 988) faults.push('clipped');
    if (bottom<900 && (scene.feetVisible || width<.26)) faults.push('wide full-body view');
    if (scene.rightFloorVisible===false) faults.push('route obscured');
    if (faults.length) result.issues.push({frame: observed, faults});
  }
  if (totalFrames - priorFrame > 96) incomplete = true;
  if (result.issues.length) result.status = 'drift';
  else if (!incomplete && result.firstHeight != null) result.status = 'within framing at sampled times';
  return result;
}
