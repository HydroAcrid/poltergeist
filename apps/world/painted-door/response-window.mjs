// One language instruction describes the whole step, including planting both
// boots. Let the first post-step image come back before issuing another input.
export const responseWatchdogMs = 8_000;
export function isEncounterStep(command) {
  return Boolean(command.encounter) && ['A','D','S'].includes(command.key);
}
export function reviewableFrame(appliedFrame, observed, fps) {
  return observed >= appliedFrame + Math.ceil(fps * 1.5);
}

// Reserve only the remainder of a step that reached the provider. Its normal
// visual watchdog still wins, including when inference stalls at the cut.
export function remainingReactionTail(step, now, allowance) {
  if (step?.outcome !== 'awaiting-pixels' || !isEncounterStep(step) || !Number.isFinite(step.at) ||
      !Number.isSafeInteger(allowance) || allowance <= 0) return 0;
  return Math.max(0, Math.min(allowance, responseWatchdogMs, step.at + responseWatchdogMs - now));
}

// A held observation point and a deliberate sidestep can put the same player
// outside the normal camera tracking gate. This comparison verifies only the
// result of the applied step; it cannot authorize another move.
export function sameReviewSubject(before, after) {
  function scale(s) {
    const box = s?.bodyBox;
    if (s?.visible !== true || s.playerCount !== 1 || s.playerMatch !== true ||
        s.shoulderView !== 'rear-right' || !Array.isArray(box) || box.length !== 4 ||
        !box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) ||
        box[2] <= box[0] || box[3] <= box[1]) return null;
    return {height:box[2]-box[0], width:box[3]-box[1]};
  }
  const a = scale(before), b = scale(after);
  return Boolean(a && b && b.height/a.height >= .72 && b.height/a.height <= 1.35 &&
    b.width/a.width >= .65 && b.width/a.width <= 1.45);
}
