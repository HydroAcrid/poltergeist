// Composition of the hallway seed in normalized, uncropped native coordinates.
export const shoulderFrame = { x: 0.265, height: 0.385 };

export function assessFraming(events, totalFrames) {
  const samples = events.filter((event) => event.scene && Number.isInteger(event.observed));
  const result = {status: 'insufficient', samples: samples.length, firstHeight: null, lastHeight: null, issues: []};
  let priorFrame = 0;
  let incomplete = samples.length < 3 || !totalFrames;
  for (const {scene, observed} of samples) {
    // Frames are 24 fps. A gap longer than four seconds leaves this stretch unverified.
    if (observed <= priorFrame || observed - priorFrame > 96) incomplete = true;
    priorFrame = observed;
    const box = scene.bodyBox;
    if (!scene.visible || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) {
      incomplete = true;
      continue;
    }
    const [top, left, bottom, right] = box;
    const height = (bottom - top) / 1000;
    const centre = (left + right) / 2000;
    if (height <= 0 || left >= right) { incomplete = true; continue; }
    result.firstHeight ??= height;
    result.lastHeight = height;
    const faults = [];
    if (height < shoulderFrame.height * 0.75) faults.push('too distant');
    if (height > shoulderFrame.height * 1.3) faults.push('too close');
    if (Math.abs(centre - shoulderFrame.x) > 0.17) faults.push('left the shoulder framing');
    if (top < 15 || left < 12 || right > 988 || bottom > 985) faults.push('clipped');
    if (faults.length) result.issues.push({frame: observed, faults});
  }
  if (totalFrames - priorFrame > 96) incomplete = true;
  if (result.issues.length) result.status = 'drift';
  else if (!incomplete && result.firstHeight != null) result.status = 'within framing at sampled times';
  return result;
}
