export function observedCrossing(track, scene, frameAt) {
  if (!Number.isFinite(frameAt) || frameAt <= (track.latestAt || 0)) return false;
  track.latestAt = frameAt;
  if (!scene.visible || scene.doorwayProgress === 'approaching') {
    delete track.thresholdAt;
    return false;
  }
  if (scene.doorwayProgress === 'at-threshold' && scene.goal?.[0] >= 860) {
    track.thresholdAt ??= frameAt;
  }
  return scene.doorwayProgress === 'through' &&
    Number.isFinite(track.thresholdAt) &&
    track.forwardAt >= track.thresholdAt && track.forwardAt < frameAt &&
    frameAt - track.thresholdAt < 10000;
}

// Brain stops at a confirmed threshold. Allow the final stride only when the
// current frame shows a clear doorway and no intervening floor obstruction.
export function canCrossThreshold(track, scene, choice) {
  if (!choice.successClaim || !Number.isFinite(track.thresholdAt) ||
      track.forwardAt >= track.thresholdAt || !scene.visible ||
      scene.pose !== 'upright' || scene.threat === 'startling' ||
      scene.doorwayProgress !== 'at-threshold' || !scene.goal || scene.goal[0] < 860)
    return false;
  const [y, x] = scene.goal;
  const midX = (scene.feet.left[1] + scene.feet.right[1]) / 2;
  const left = Math.min(midX, x) - 60, right = Math.max(midX, x) + 60;
  return !scene.obstacles.some(({ box, relation }) =>
    relation === 'crossing' || !box || (box[2] >= y - 50 && box[1] <= right && box[3] >= left));
}
