// One language instruction describes the whole step, including planting both
// boots. Let the first post-step image come back before issuing another input.
export const responseWatchdogMs = 8_000;
export function isEncounterStep(command) {
  return Boolean(command.encounter) && ['A','D','S'].includes(command.key);
}
export function reviewableFrame(appliedFrame, observed, fps) {
  return observed >= appliedFrame + Math.ceil(fps * .75);
}
