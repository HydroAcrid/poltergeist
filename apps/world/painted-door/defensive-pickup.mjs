// One uninterrupted native shot. The provider receives a body direction and a later
// recovery; neither is evidence that a pose was rendered.
const poses = {
  duck: 'Keep both boots on their floorboards. Bend both knees deeply and lower the hips, helmet and orange backpack below the crossing motion. Lift the free left forearm across the helmet. Keep the lit flashlight in the right hand pointed low. Hold the low silhouette.',
  shield: 'Keep both boots on their floorboards. Twist the shoulders away and raise the free left forearm visibly across the helmet, elbow high. Tuck the chin behind the forearm while the right hand keeps the lit flashlight low. Hold this shielding pose.',
  recoil: 'Keep both boots on their floorboards. Recoil once through the whole upper body: bend the knees, pull the shoulders and helmet back from the obstruction, and raise the free left hand in surprise. Hold briefly in this braced position.',
};
const continuity = 'Continue the current native shot with the existing single explorer, existing effect, hallway, lighting and floor marks. Lock the observer position, angle and focal length. Animate only the explorer; the effect can continue its existing motion.';
export function guardInstruction(pose) {
  return Object.hasOwn(poses,pose) ? continuity+' '+poses[pose] : null;
}
const recovery = continuity+' Let the existing explorer straighten its knees, lower its left forearm, bring the right-hand flashlight back to working height, and stand balanced on the same two floorboards. Wait there.';

export function guardMatchesView(scene, obstacle) {
  // A startled expression can precede physical recoil. Only an explicitly
  // unguarded player can receive a new direction, and later frames verify it.
  const unguarded = scene.guardPose === 'none' &&
    (scene.pose === 'upright' || (scene.pose === 'startled' && scene.move?.guard === 'recoil'));
  if (!unguarded || !guardInstruction(scene.move?.guard) || !scene.visible || scene.playerCount!==1 || !scene.playerMatch ||
      scene.shoulderView!=='rear-right' || !scene.feetVisible ||
      scene.threat!=='startling' || scene.move.intent!=='hold' || scene.move.avoiding!==true) return false;
  if (scene.move.guard==='recoil') return true;
  const b=obstacle?.box, upper=scene.upperBodyBox;
  return obstacle?.relation==='crossing' && Array.isArray(b) && Array.isArray(upper) &&
    b[0]<upper[2] && b[2]>upper[0];
}

function samePlantedPlayer(before,scene) {
  if (!scene?.visible || scene.playerCount!==1 || !scene.playerMatch || scene.shoulderView!=='rear-right' ||
      !scene.feetVisible || !before?.feetVisible) return false;
  return ['left','right'].every(boot => before.feet?.[boot]?.length===2 && scene.feet?.[boot]?.length===2 && before.feet[boot].every((v,i)=>
    Number.isFinite(scene.feet?.[boot]?.[i]) && Math.abs(v-scene.feet[boot][i])<=50));
}

export function createGuardPickup(fps) {
  let current = null;
  return {
    get active() { return current!==null; },
    get basisImage() { return current?.basis.image; },
    reserve(command,basis) {
      if (current || !command.encounter || !basis?.image || basis.observed!==command.observed ||
          basis.scene.move?.guard!==command.guard || !guardInstruction(command.guard)) return false;
      current={command,basis,applied:null,seen:null,recovering:false};
      return true;
    },
    applied(frame,at) {
      if (current) Object.assign(current,{applied:frame,at});
    },
    cancel() { current=null; },
    observe(scene,observed) {
      const shot=current;
      if (!shot || shot.recovering || shot.applied===null || observed<=shot.applied) return null;
      const same=samePlantedPlayer(shot.basis.scene,scene);
      shot.same=same;
      if (!same || shot.seen || observed-shot.applied<Math.ceil(fps*.5) ||
          scene.guardPose!==shot.command.guard || shot.basis.scene.guardPose!=='none') return null;
      // A duck changes the visible body height without moving either planted boot.
      if (scene.guardPose==='duck' && !(scene.bodyBox?.[0]-shot.basis.scene.bodyBox?.[0]>=50)) return null;
      if (scene.guardPose==='recoil' && scene.pose!=='startled') return null;
      shot.seen=observed;
      return {encounter:shot.command.encounter,guard:shot.command.guard,basis:shot.basis.observed,
        appliedFrame:shot.applied,checkedFrame:observed};
    },
    // One visual beat for the pose (107 frames at 24 fps in the directed pickup).
    // Allow a slow independent read before recovering, bounded on real elapsed time.
    async advance(frame,now,send) {
      const shot=current;
      if (!shot || shot.applied===null || shot.recovering) return;
      const due=frame-shot.applied>=Math.ceil(fps*4.4) && shot.seen;
      if (!due && now-shot.at<8000) return;
      shot.recovering=true;
      try {
        if (shot.same===true) await send(recovery);
      } finally { if (current===shot) current=null; }
    },
    tail(now,limit) {
      return current?.applied!=null ? Math.max(0,Math.min(limit,current.at+8000-now)) : 0;
    },
  };
}
