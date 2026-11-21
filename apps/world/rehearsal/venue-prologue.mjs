import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Filmed from this reviewed stock seed. The first take includes native frame
// 414, which also seeded the second. Its first 168 frames end on the JPEG
// passed unmodified into the first fresh crowd render.
const reviewedSeed = '7a47d68c3cc99e78ebc2ab3eebc3a162e6b1983e148f83b619d86ed4f787c755';
const scenes = [
  {title:'Into the hallway', movie:'venue-prologue/approach.mp4', frames:414,
   sha:'bee877b0c13d8615b63069150a85ea5f221156d2369313f22e6c021514692c96',
   tail:'venue-prologue/approach-final.jpg', tailSha:'b5c4bf6ee0436be710d0c63fd684ca08093d9e5711ee048947bed0347efaa064'},
  {title:'Bats in the flashlight', movie:'prepared-media/bat-swarm.mp4', frames:168,
   sha:'523e2bdfcefc6a0a06656236292540167d9922d7e61c3d57f7d3a18346364e9f',
   tail:'venue-prologue/encounter-final.jpg', tailSha:'e10355627e68d4a98a83d0ba90a98edc7cf7b2e453a523822f5ceb9d46e0f1d5'},
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function loadVenuePrologue(root, seedDigest) {
  if (seedDigest !== reviewedSeed) return [];
  try {
    return scenes.map(scene => {
      const filePath = resolve(root,scene.movie);
      const finalFrame = readFileSync(resolve(root,scene.tail));
      if (digest(readFileSync(filePath)) !== scene.sha || digest(finalFrame) !== scene.tailSha)
        throw new Error('The venue footage has changed.');
      return {title:scene.title,filePath,finalFrame,durationMs:scene.frames*1000/24};
    });
  } catch {
    // An incomplete installation still supports ordinary photo-to-world rendering.
    return [];
  }
}
