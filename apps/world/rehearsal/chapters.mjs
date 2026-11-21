import { audienceCanSeeApproach } from './seed-review.mjs';

export const matchDurationMs = 600_000;
export const fiveMinuteShowMs = 300_000;
// Cut on the next verified quiet view, with space to finish a current encounter.
export const chapterCutMs = 55_000;
export const chapterLimitMs = 90_000;

export function checkpointEligible(scene, navigationHeld) {
  return !navigationHeld && scene?.visible && scene.playerMatch && scene.pose==='upright' &&
    scene.threat!=='startling' && Array.isArray(scene.ahead) &&
    scene.ahead.length===2 && scene.ahead.every(n=>Number.isInteger(n) && n>=0 && n<=1000) &&
    audienceCanSeeApproach({playerCount:scene.playerCount, view:scene.shoulderView==='rear-right'?'right-shoulder':'other',
      routeVisible:scene.rightFloorVisible, diagonal:scene.aisleHeading==='diagonal-right', standingOnFloor:scene.feetVisible===true,
      bodyBox:scene.bodyBox});
}

export function validCheckpoint(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length>=100 && bytes.length<=48000 &&
    bytes.readUInt16BE(0)===0xffd8 && bytes.readUInt16BE(bytes.length-2)===0xffd9;
}
