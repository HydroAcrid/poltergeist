import {guardMatchesView} from '../painted-door/defensive-pickup.mjs';
// All public coordinates are [y,x] on the original, uncropped frame, 0–1000.
const aspect = 16 / 9;
const point = (p) =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000);
const box = (b) =>
  Array.isArray(b) &&
  b.length === 4 &&
  b.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) &&
  b[0] < b[2] &&
  b[1] < b[3];
const effects = [
  [
    /\b(?:bats?|bat swarm)\b/i,
    /\bbats?\b|winged swarm/i,
    'One flock emerges from the doorway ahead and circles at chest height over the next footstep. Its moving wings repeatedly cross the flashlight in that same spot while the explorer decides how to respond. Let the wing silhouettes read against the lit far wall, leave the robot visible and keep the hallway intact.',
  ],
  [
    /\b(?:hurricanes?|tornado(?:es)?|cyclones?|twisters?)\b/i,
    /vortex|funnel|cyclon|tornad|twist(?:er|ing debris)|rotating (?:dust|debris)|spiral(?:ing)? debris/i,
    'Form a tall rotating funnel of illuminated dust and airborne debris in the open aisle ahead. Let the vortex cross the flashlight beam while the walls, floor and explorer stay recognizable.',
  ],
  [
    /\b(?:thunderstorms?|lightning|thunder)\b/i,
    /lightning|storm cloud|rain curtain|slanting rain|rain shaft/i,
    'Storm clouds gather below the ceiling ahead. A blue-white sheet of lightning silhouettes a curtain of driving rain that crosses the flashlight beam. Keep the explorer and its path visible.',
  ],
  [
    /\b(?:breezes?|light drafts?)\b/i,
    /paper|sheet|leaf|leaves|debris/i,
    'Let the light breeze carry a few loose sheets across the next footsteps in the flashlight beam. Keep the breeze gentle.',
  ],
  [
    /\b(?:gusts?|wind(?:s|y)?)\b|\bpaper storm\b/i,
    /paper|sheet|leaf|leaves|debris/i,
    'Blow a clearly visible stream of loose papers across the next footsteps, from one side of the walking lane to the other.',
  ],
  [
    /chair|stool|seat/i,
    /chair|stool|seat/i,
    'Put the tipped chair across the next footsteps, with its legs spanning the walking lane.',
  ],
  [/banana|peel/i, /banana|peel/i],
  [/fog|mist|smoke/i, /fog|mist|smoke/i],
  [/marble/i, /marble/i],
  [/balloon/i, /balloon/i],
  [/bucket|pail/i, /bucket|pail|mopping cart/i,
    'The rolling bucket cuts across the light on the next footstep and stops just ahead of the robot. Its rim comes only to the robot’s knees. Keep it beside the robot in depth as it crosses the aisle.'],
  [/flicker|blackout|lights out/i, /flicker|blackout|shadow|dark patch/i,
    'One existing overhead light above the next footstep falters and stays dim. A distinct patch of darkness falls across the route ahead. Keep the other practical lights and the explorer’s flashlight on so the change stays readable.'],
];
const ignore = new Set(
  'the this that from into across place drop throw create large small giant tiny bright robot hallway path aisle exit floor beside front behind walking goes appears suddenly rolls rolling slide scare block blocks some with toward under its next'.split(
    ' ',
  ),
);
function wordRoot(word) {
  return word.toLowerCase().replace(/(?:ing|es|s)$/, '');
}
export function describeEffect(text) {
  const match = effects.find(([pattern]) => pattern.test(text));
  const words = (text.toLowerCase().match(/[a-z]{3,}/g) || [])
    .filter((w) => !ignore.has(w))
    .map(wordRoot);
  return {
    matches: (label) =>
      match
        ? match[1].test(label)
        : (label.match(/[a-z]{3,}/gi) || [])
            .map(wordRoot)
            .some((w) => words.includes(w)),
    hint:
      match?.[2] ||
      'Place the visible effect across the robot’s next footsteps, where it will encounter it as it continues.',
  };
}
export function freshObservation(observation, now, lastMoveAt = 0) {
  if (
    !observation ||
    !Number.isFinite(observation.at) ||
    observation.at > now ||
    observation.at < lastMoveAt
  )
    return false;
  // ER2 has a 14s request deadline. An answer is usable only on the same unmoved
  // view and only as it arrives. An answer from an earlier command cannot aim a send.
  return now - observation.at <= 14000 && now - observation.received <= 1500;
}
export function floorCorridor(scene) {
  if (
    !scene?.visible ||
    !point(scene.feet?.left) ||
    !point(scene.feet?.right) ||
    !point(scene.ahead)
  )
    return null;
  const feet = scene.feet.left.map((n, i) => (n + scene.feet.right[i]) / 2);
  const dy = scene.ahead[0] - feet[0],
    dx = scene.ahead[1] - feet[1];
  const distance = Math.hypot(dy, dx * aspect);
  if (distance < 35 || distance > 650) return null;
  // The ahead observation is a walkable-floor point one or two strides away.
  // A goal beyond an unobserved floor region is insufficient to place an object.
  const radius = Math.max(
    16,
    Math.min(
      70,
      Math.abs(scene.feet.right[1] - scene.feet.left[1]) * aspect * 0.6 || 16,
    ),
  );
  return { feet, dy, dx, radius };
}
function intervalHits(corridor, b, start, end, radius, airborne = false) {
  if (!box(b)) return false;
  // Only the object's floor contact patch can obstruct a footstep. A tall chair
  // by a side wall may overlap the robot at head height while its legs are clear.
  const floorTop = airborne ? b[0] : b[2] - Math.min(35, (b[2] - b[0]) * 0.18);
  const coords = [
    [corridor.feet[0], corridor.dy, floorTop - radius, b[2] + radius],
    [
      corridor.feet[1],
      corridor.dx,
      b[1] - radius / aspect,
      b[3] + radius / aspect,
    ],
  ];
  for (const [origin, delta, lo, hi] of coords) {
    if (Math.abs(delta) < 0.001) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    const a = (lo - origin) / delta,
      c = (hi - origin) / delta;
    start = Math.max(start, Math.min(a, c));
    end = Math.min(end, Math.max(a, c));
    if (start > end) return false;
  }
  return true;
}
export function observedFootprint(o) {
  const f=o.floorBox, b=o.box;
  if (!box(f) || !box(b) || f[0]<b[0] || f[1]<b[1] || f[2]>b[2] || f[3]>b[3]) return null;
  // A solid object's body and handle can span most of the screen. A reported
  // base that reaches into the upper half cannot establish ground contact.
  if (o.solid!==false && (f[0] < (b[0]+b[2])/2 || b[2]-f[2] > f[2]-f[0])) return null;
  return f;
}
function obstacleHits(c, o, start, end, radius, {credit=false, airborne=false}={}) {
  if (airborne && o.relation==='crossing') return intervalHits(c,o.box,start,end,radius,true);
  if (Object.hasOwn(o,'floorBox')) {
    const base=observedFootprint(o);
    if (base) return intervalHits(c,base,start,end,radius,true);
    if (credit) return false; // Unknown floor contact cannot prove an audience intervention.
  }
  return intervalHits(c,o.box,start,end,radius);
}

export function placementTarget(scene, exclude = () => false) {
  const c = floorCorridor(scene);
  if (!c) return null;
  const obstacles = (scene.obstacles || []).filter((o) => !exclude(o.label));
  for (const step of [0.88, 0.66, 1]) {
    const p = c.feet.map((n, i) =>
      Math.round(n + step * (i === 0 ? c.dy : c.dx)),
    );
    // Leave room for the obstacle itself and for the robot to approach it on camera.
    const sideMargin = Math.max(80, 2 * c.radius / aspect);
    if (p[0] < 60 || p[0] > 910 || p[1] < sideMargin || p[1] > 1000 - sideMargin) continue;
    if (
      !obstacles.some((o) => obstacleHits(c,o,0.12,step,c.radius*.6))
    )
      return p;
  }
  return null;
}
export function inspectPlacement(
  scene,
  effect,
  baseline,
) {
  const c = floorCorridor(scene);
  if (!c) return null;
  const matches = (scene.obstacles || []).filter(
    (o) => effect.matches(o.label) && box(o.box),
  );
  const before = baseline.filter((o) => effect.matches(o.label) && box(o.box));
  // An ordinary chair already in view must not be credited as a newly tipped
  // chair. A new instance, or a newly observed tipped state, provides evidence.
  const tipped = (o) => /toppl|tipp|overturn|fallen|upend/i.test(o.label);
  function sameFootprint(a, b) {
    return (
      Math.abs(a.box[2] - b.box[2]) < 55 &&
      Math.abs(a.box[1] + a.box[3] - b.box[1] - b.box[3]) < 120
    );
  }
  const candidates = matches.filter(
    (o) =>
      (tipped(o) && !before.some(tipped)) ||
      (o.relation === 'crossing' && before.length > 0 &&
        !before.some(prior => sameFootprint(prior,o) || intervalHits(c,prior.box,0.17,1.45,c.radius,true)) &&
        intervalHits(c,o.box,0.17,1.45,c.radius,true)) ||
      (matches.length > before.length &&
        !before.some((prior) => sameFootprint(prior, o))),
  );
  if (scene.feetVisible===false || scene.playerMatch===false || scene.playerCount > 1)
    return {visible:candidates.length>0,inPath:false,contact:false,soleThreat:false};
  const inPath = candidates.filter((o) =>
    obstacleHits(c,o,0.17,1.45,c.radius,{credit:true,airborne:true}),
  );
  // In a diagonal shot the distant aisle point and the explorer's next
  // landing can be quite different directions. A sidestep can confront a
  // new object when the object's floor contact lies between the visible
  // boots and the independently chosen landing. This is placement evidence
  // only; contact, fear and a successful bypass still need their own pixels.
  const blocksLanding = !inPath.length && candidates.length === 1 &&
    blocksChosenLanding(scene,c,candidates[0],effect.matches);
  const near = inPath.filter((o) =>
    obstacleHits(c,o,0,0.48,c.radius*.72,{credit:true}),
  );
  const otherNear = (scene.obstacles || []).some(
    (o) =>
      !candidates.includes(o) &&
      obstacleHits(c,o,0,.48,c.radius*.72),
  );
  return {
    visible: candidates.length > 0,
    inPath: inPath.length > 0 || blocksLanding,
    contact: near.length === 1 && !otherNear,
    soleThreat:
      inPath.length === 1 &&
      !(scene.obstacles || []).some(
        (o) => o !== inPath[0] && obstacleHits(c,o,.17,1.45,c.radius),
      ),
  };
}

function blocksChosenLanding(scene, route, obstacle, matches) {
  const move = scene.move;
  const key = {step_left:'A',step_right:'D'}[move?.intent];
  if (!key || move.avoiding !== true || scene.playerCount !== 1 || !scene.playerMatch ||
      !scene.feetVisible || scene.pose !== 'upright' || obstacle.solid === false ||
      !encounterLanding(scene,matches,key)) return false;
  const step = floorCorridor({...scene,ahead:move.target});
  if (!step) return false;
  // A proposal about something behind the player or far down the aisle
  // cannot turn that object into an obstacle at the current footstep.
  const length = Math.hypot(step.dy,step.dx*aspect);
  const routeLength = Math.hypot(route.dy,route.dx*aspect);
  const forward = step.dy*route.dy + step.dx*route.dx*aspect*aspect;
  if (forward <= .5*length*routeLength || length > 1.5*routeLength) return false;
  const sweep = corridor => obstacleHits(corridor,obstacle,.12,.95,step.radius*.65,{credit:true}) &&
    !scene.obstacles.some(o => o!==obstacle && o.solid!==false && obstacleHits(corridor,o,.12,.95,step.radius*.65));
  if (sweep(step)) return true;
  if (!observedFootprint(obstacle)) return false;
  // The midpoint of an offset stance can miss the stepping boot. Only a
  // visible measured base and a valid, chosen lateral landing can use that boot.
  const boots=[scene.feet.left,scene.feet.right].sort((a,b)=>a[1]-b[1]);
  const foot=key==='A' ? boots[0] : boots[1];
  return sweep({...step,feet:foot,dy:move.target[0]-foot[0],dx:move.target[1]-foot[1]});
}

// A sidestep opens a route only when the same obstacle is still visible and
// both boots have moved to clear floor on the instructed side of it.
// The Brain chooses an observed open patch. Use the camera coordinates from
// that same image and reject a patch inside a solid obstacle's footprint.
export function encounterLanding(scene, matches, key, target = scene?.move?.target) {
  if (!point(target) || scene.feetVisible === false) return null;
  const corridor = floorCorridor(scene);
  const targets = scene.obstacles.filter(o => matches(o.label) && box(o.box));
  if (!corridor || targets.length !== 1) return null;
  const obstacle = targets[0].box;
  const margin = corridor.radius / aspect;
  if (key === 'S') {
    const dy = target[0] - corridor.feet[0];
    const dx = target[1] - corridor.feet[1];
    if (dy*corridor.dy + dx*corridor.dx*aspect*aspect >= 0) return null;
  }
  if (key === 'A' && target[1] >= obstacle[1] - margin ||
      key === 'D' && target[1] <= obstacle[3] + margin) return null;
  if (scene.obstacles.some(o => {
    if (o.solid===false || !box(o.box)) return false;
    const base=observedFootprint(o);
    const [top,left,bottom,right]=base ?? [o.box[2],o.box[1],o.box[2],o.box[3]];
    return target[0]>=top-corridor.radius && target[0]<=bottom+corridor.radius &&
      target[1]>=left-margin && target[1]<=right+margin;
  })) return null;
  return {target: target.map(Math.round), obstacle: obstacle.map(Math.round)};
}

export function compareEncounterStep(before, after, result, matches, key) {
  const a = floorCorridor(before), b = floorCorridor(after);
  if (!a || !b || !before.feetVisible || !after.feetVisible || after.pose !== 'upright' ||
      !result?.visible) return 'unconfirmed';
  const targets = scene => scene.obstacles.filter(o => matches(o.label) && box(o.box));
  const previous = targets(before), current = targets(after);
  if (previous.length !== 1 || current.length !== 1) return 'unconfirmed';
  const old = previous[0].box, next = current[0].box;
  const centre = rect => (rect[1] + rect[3]) / 2;
  // The held camera makes floor positions comparable. If the prop moved too
  // far or changed scale, keep the result open instead of attributing its
  // displacement to the player.
  const propShift = centre(next)-centre(old);
  if (Math.abs(propShift)>70 || Math.abs(next[2]-old[2])>65) return 'unconfirmed';
  const minTravel = Math.max(28, Math.abs(before.feet.right[1]-before.feet.left[1])*.65);
  const footDx = b.feet[1]-a.feet[1], footDy = b.feet[0]-a.feet[0];
  if (key === 'S') {
    const range = (feet, rect) => Math.hypot(feet[0]-rect[2],(feet[1]-centre(rect))*aspect);
    const away = -(footDy*a.dy + footDx*a.dx*aspect*aspect)/Math.hypot(a.dy,a.dx*aspect);
    if (away>minTravel && range(b.feet,next)-range(a.feet,old)>minTravel) return 'backed-away';
  }
  if (result.inPath) return 'still-blocked';
  if (key !== 'A' && key !== 'D') return 'unconfirmed';
  const side = key === 'A' ? -1 : 1;
  const boots = [after.feet.left[1],after.feet.right[1]];
  const feetClear = key === 'A' ? Math.max(...boots)<next[1] : Math.min(...boots)>next[3];
  const routeClear = !(after.obstacles || []).some(o => (o.solid!==false || o.relation==='crossing') &&
    obstacleHits(b,o,.17,1.45,b.radius,{airborne:true}));
  return feetClear && routeClear && footDx*side>minTravel && (footDx-propShift)*side>minTravel
    ? 'route-open' : 'unconfirmed';
}

export function createPlacementController(round, send, report, { cueLeadMs = 0 } = {}) {
  let latest,
    lastMove = 0,
    resumeAfter = -1;
  const jobs = new Map();
  let holdNewPlacements = false;
  const now = () => Date.now();

  // Allow an already running 14s vision request and a second read of the settled view.
  const readWindowMs = 30_000;
  function active() {
    return [...jobs.values()].find(job => !job.closed && job.prop.cueAt != null);
  }
  function closeJob(job, status) {
    if (job.closed) return;
    job.closed = true;
    if (status) job.prop.placement = status;
    if (job.prop.cueAt != null) {
      resumeAfter = Math.max(resumeAfter, latest?.frame ?? -1);
      send({ releaseEncounter: job.prop.id });
    }
    if (!job.prop.acked) report(job.prop, false);
  }
  function expire(time) {
    const job = active();
    if (job && time >= job.expiresAt)
      closeJob(job, job.prop.inPath ? 'in-path' : job.prop.seen ? 'off-path' : job.prop.acked ? 'unverified' : 'failed');
  }
  function trySend(job, time) {
    if (latest?.placementReady === false || latest?.at < job.prop.cueAt) return false;
    if (job.deferredFrame != null && latest?.frame <= job.deferredFrame) return false;
    if (time < Math.max(job.prop.cueAt + cueLeadMs, job.retryAfter || 0) || !freshObservation(latest, time, lastMove) || time >= round.deadline)
      return false;
    const prop = job.prop,
      retry = prop.attempt === 1;
    const target = placementTarget(
      latest.scene,
      retry && prop.seen ? job.effect.matches : undefined,
    );
    if (!target) return false;
    prop.target = target;
    prop.attempt++;
    prop.sentAt = time;
    prop.placement = 'sent';
    job.baseline ??= latest.scene.obstacles || [];
    job.ackFrame = null;
    job.ackTime = null;
    job.previousPose = latest.scene.pose;
    job.sentObservation = latest.frame;
    job.lastChecked = null;
    const body = latest.scene.bodyBox;
    const bodyHint = box(body)
      ? `In this shot the robot is ${Math.round((body[2] - body[0]) / 10)} percent of the picture height. Use the next footfall to anchor perspective and scale. Keep the foreground between the camera and robot open.`
      : 'Place it at the same distance from the viewer as the robot’s next footstep.';
    const hint = [
      retry ? 'Relocate the existing haunting into the walking line.' : '',
      job.effect.hint, bodyHint,
    ].filter(Boolean).join(' ');
    send({
      haunt: {
        id: prop.id,
        text: prop.name,
        target,
        observed: latest.frame,
        hint,
        attempt: prop.attempt,
      },
    });
    return true;
  }
  function pump(time) {
    expire(time);
    for (const job of jobs.values()) {
      if (job.closed) continue;
      if (holdNewPlacements && job.prop.attempt===0) break;
      if (job.prop.cueAt === null) {
        const reaction = round.lastReaction;
        if (cueLeadMs && reaction && time - (reaction.presentedAt ?? reaction.at) < 3000) break;
        job.prop.cueAt = time;
        job.expiresAt = time + readWindowMs;
        round.action = 'Assessing the path';
        send({ pause: true, settleCamera: true, encounter: job.prop.id });
      }
      if (
        job.prop.placement === 'waiting' ||
        job.prop.placement === 'correcting'
      )
        trySend(job, time);
      break;
    }
  }
  return {
    add(id, text, by, time = now()) {
      if (jobs.has(id)) return;
      const prop = {
        id,
        ...(round.chapters ? {chapter:round.chapter} : {}),
        name: text,
        by,
        selectedAt: time,
        cueAt: null,
        attempt: 0,
        acked: false,
        seen: false,
        inPath: false,
        placement: 'waiting',
      };
      round.props.push(prop);
      jobs.set(id, { prop, effect: describeEffect(text) });
      pump(time);
    },
    holdForHandoff() {
      holdNewPlacements=true;
      return [...jobs.values()].every(job=>job.closed || job.prop.attempt===0);
    },
    resumeChapter() {
      latest=null;
      lastMove=0;
      resumeAfter=-1;
      holdNewPlacements=false;
      for (const job of jobs.values()) {
        if (job.closed) continue;
        job.prop.chapter=round.chapter;
        job.prop.cueAt=null;
        job.baseline=null;
        job.deferredFrame=null;
        job.retryAfter=0;
      }
    },
    tick(time = now()) { pump(time); },
    holdReason(time = now()) {
      const job = active();
      if (!job) return 'Waiting for the first frame after the encounter';
      const prop = job.prop;
      if (prop.placement === 'waiting') return 'Waiting for a stationary visible footstep';
      if (prop.placement === 'correcting') return 'Relocating the obstacle into the path';
      if (prop.placement === 'sent') return 'Waiting for provider receipt';
      if (!prop.inPath) return 'Obstacle has not been seen in the walking path';
      if (job.lastReactionFrame === latest.frame) return 'The player is reacting in place';
      if (!freshObservation(latest, time, lastMove) || !latest.placementReady)
        return 'Waiting for a fresh stationary view of the obstacle';
      return 'Forward travel would ignore the visible obstacle';
    },
    navigationPaused(time = now()) {
      const job = active();
      if (!job) return latest != null && latest.frame <= resumeAfter;
      return !job.prop.inPath || job.prop.confirmedFrame !== latest?.frame ||
        !freshObservation(latest, time, lastMove) || latest.placementReady === false ||
        job.lastReactionFrame === latest.frame;
    },
    canRespond(frame) {
      const job = active();
      return Boolean(job?.prop.inPath && job.prop.confirmedFrame === frame && latest?.placementReady);
    },
    applied(command) {
      const job = jobs.get(command.encounter);
      const pending = job?.proposedStep;
      if (!job || job.closed || !pending || pending.basis!==command.observed || pending.key!==command.key ||
          !Number.isInteger(command.appliedFrame) || command.appliedFrame<command.observed) return;
      job.step={...pending,appliedFrame:command.appliedFrame};
      job.proposedStep=null;
      job.prop.response={key:pending.key, basis:pending.basis, appliedFrame:command.appliedFrame, outcome:'awaiting-pixels'};
    },
    reviewed(receipt) {
      const job = jobs.get(receipt.encounter), step=job?.step;
      if (!step || job.closed || step.appliedFrame!==receipt.appliedFrame || step.basis!==receipt.basis ||
          step.key!==receipt.key) return;
      if (receipt.reason==='post-step pixels') {
        if (Number.isInteger(receipt.observed) && receipt.observed>step.appliedFrame && step.reviewFrame==null)
          step.reviewFrame=receipt.observed;
      } else if (['vision timeout','tracking lost','encounter closed'].includes(receipt.reason)) {
        job.prop.response.outcome='unconfirmed';
        send({stepFeedback:{encounter:job.prop.id,appliedFrame:step.appliedFrame,observed:null,outcome:'unconfirmed'}});
        job.step=null;
      }
    },
    moved(time = now()) {
      lastMove = time;
    },
    acknowledged(id, attempt, at, frame) {
      const job = jobs.get(id);
      if (
        !job ||
        job.closed ||
        attempt !== job.prop.attempt || job.prop.placement !== 'sent' ||
        !Number.isFinite(at) || at < job.prop.sentAt ||
        (frame != null && (!Number.isInteger(frame) || frame < job.sentObservation)) ||
        job.ackTime != null
      )
        return;
      const p = job.prop;
      job.ackTime = at;
      job.ackFrame = frame;
      job.expiresAt = at + readWindowMs;
      p.placement = 'acknowledged';
      if (!p.acked) {
        p.acked = true;
        report(p, true);
      }
    },
    deferred(id, attempt, observed) {
      const job = jobs.get(id);
      if (!job || job.closed || job.prop.placement !== 'sent' ||
          attempt !== job.prop.attempt || observed !== job.sentObservation) return;
      // Nothing reached the provider. Re-aim this same proposal only after another observation.
      job.deferredFrame = observed;
      job.prop.attempt--;
      job.prop.placement = job.prop.attempt ? 'correcting' : 'waiting';
      if (!job.prop.attempt) job.baseline = null;
    },
    failed(id, attempt) {
      const job = jobs.get(id);
      if (!job || job.closed || job.prop.attempt !== attempt) return;
      closeJob(job, job.prop.acked ? 'unverified' : 'failed');
    },
    observe(scene, frame, at, time = now(), placementReady = true, guardReview = null) {
      if (!Number.isInteger(frame) || !Number.isFinite(at) || at > time || (latest && (frame <= latest.frame || at < latest.at))) return;
      expire(time);
      latest = { scene, frame, at, received: time, placementReady };
      const job = [...jobs.values()].find((j) => !j.closed);
      if (
        job &&
        job.ackTime != null &&
        frame !== job.lastChecked &&
        at > job.ackTime &&
        (job.ackFrame == null || frame > job.ackFrame)
      ) {
        // Proof belongs to the frame's capture time. A slow response for a
        // pre-send frame cannot verify a send, even if it arrives afterward.
        const p = job.prop;
        const result = inspectPlacement(scene, job.effect, job.baseline);
        const directed=job.guard;
        if (guardReview && directed && result?.inPath && result.soleThreat && !p.reactedAt && guardReview.encounter===p.id &&
            guardReview.guard===directed.guard && guardReview.basis===directed.basis &&
            Number.isInteger(guardReview.appliedFrame) && guardReview.appliedFrame>=directed.basis &&
            guardReview.checkedFrame===frame && frame>guardReview.appliedFrame &&
            scene.guardPose===directed.guard && scene.visible && scene.playerCount===1 && scene.playerMatch &&
            scene.shoulderView==='rear-right' && scene.feetVisible && freshObservation(latest,time,lastMove)) {
          const scare=directed.guard==='recoil' && scene.pose==='startled';
          p.guardReview={...guardReview};
          p.reactedAt=at;
          p.observedReaction=scare ? 'scare' : 'defend';
          if (scare) round.fear++;
          round.lastReaction={at,presentedAt:time,name:p.name,flinch:scare};
          closeJob(job);
        }
        if (job.step?.reviewFrame===frame) {
          const step=job.step;
          const outcome=freshObservation(latest,time,lastMove) ?
            compareEncounterStep(step.scene,scene,result,job.effect.matches,step.key) : 'unconfirmed';
          Object.assign(p.response,{checkedFrame:frame,outcome});
          send({stepFeedback:{encounter:p.id,appliedFrame:step.appliedFrame,observed:frame,outcome}});
          job.step=null;
          if (outcome==='route-open') {
            p.inPath=false;
            p.observedReaction='sidestep';
            p.reactedAt=at;
            round.lastReaction={at,presentedAt:time,name:p.name,flinch:false};
            closeJob(job,'off-path');
          }
        }
        if (!job.closed && result && placementReady && freshObservation(latest, time, lastMove)) {
          job.lastChecked = frame;
          if (result.visible && !p.seen) {
            p.seenAt = at;
            p.seenPresentedAt = time;
          }
          if (result.inPath && !p.inPath) p.inPathPresentedAt = time;
          p.seen ||= result.visible;
          p.inPath = result.inPath;
          if (result.inPath) {
            p.placement = 'in-path';
            p.confirmedFrame = frame;
            if (!job.wasInPath) job.expiresAt = time + readWindowMs;
            p.assessment = ['ordinary', 'startling'].includes(scene.threat)
              ? scene.threat
              : 'unclear';
            job.soleThreat=result.soleThreat;
            const visibleStumble = scene.feetVisible !== false && result.contact && scene.pose === 'stumbling';
            const visibleStartle =
              result.soleThreat &&
              scene.pose === 'startled' &&
              (p.assessment === 'startling' || p.reactionRequestedAt != null);
            if (
              (visibleStumble || visibleStartle) &&
              (p.reactionRequestedAt == null || at > p.reactionRequestedAt) &&
              job.wasInPath &&
              job.previousPose === 'upright' &&
              !p.reactedAt
            ) {
              p.reactedAt = at;
              p.observedReaction = 'scare';
              round.fear++;
              round.lastReaction = { at, presentedAt: time, name: p.name, flinch: true };
            }
            // Keep tracking the verified object until contact or the robot passes.
            // Sending a second hazard into the same encounter blurs attribution.
            if (p.reactedAt) closeJob(job);
            job.wasInPath = true;
          } else if (job.wasInPath) {
            closeJob(job, result.visible ? 'off-path' : 'unverified');
          } else if (at - job.ackTime >= 1000) {
            const nearby = result.visible && scene.obstacles.find((o) =>
              o.relation === 'noticeable' && job.effect.matches(o.label) && box(o.box));
            if (latest.placementReady && nearby && !p.noticeRequestedAt && scene.pose === 'upright') {
              const feetX = (scene.feet.left[1] + scene.feet.right[1]) / 2;
              const toward = (nearby.box[1] + nearby.box[3]) / 2 < feetX ? 'left' : 'right';
              p.noticeRequestedAt = time;
              job.retryAfter = time + 1400;
              job.lastReactionFrame = frame;
              send({ reaction: 'notice', toward, encounter: p.id, observed: frame });
            }
            // A correction needs time for at least one fresh independent
            // reading. The response reserve belongs only to a step sent on
            // the wire; it cannot rescue an unseen last-second relocation.
            const nextReadMs = Math.max(1800,time-at);
            if (p.attempt === 1 && round.deadline - time > nextReadMs) {
              p.placement = 'correcting';
              job.ackTime = null;
            } else {
              closeJob(job, result.visible ? 'off-path' : 'unverified');
            }
          }
          job.previousPose = scene.pose;
        }
      }
      pump(time);
    },
    characterCommand(decision, at = now()) {
      const key = decision.action.key;
      if (this.navigationPaused(at)) return null;
      const command = { key, ms: decision.action.holdMs };
      const job = active();
      if (!job) return key === 'NOOP' ? null : command;
      if (job.lastCommandFrame === latest.frame) return null;
      const { prop } = job;
      const scene = latest.scene;
      if (key === 'NOOP') {
        const matching = scene.obstacles.filter(o=>job.effect.matches(o.label));
        if (job.guard || matching.length!==1 || !job.soleThreat || scene.guardPose!=='none' || decision.decision?.source!=='model' ||
            decision.decision.intent!=='hold' || !guardMatchesView(scene,matching[0])) return null;
        job.guard={guard:scene.move.guard,basis:latest.frame};
        job.lastReactionFrame=latest.frame;
        prop.reactionRequestedAt=at;
        return {reaction:'guard',guard:scene.move.guard,encounter:prop.id,observed:latest.frame};
      }
      if (key === 'W') {
        // A passable effect may be crossed deliberately. A routine walk, or a
        // walk into a solid obstruction, cannot serve as an encounter response.
        const c = floorCorridor(scene);
        const blocked = !c || scene.obstacles.some(o => (o.solid !== false || o.relation === 'crossing') &&
          obstacleHits(c,o,.17,1.45,c.radius,{airborne:true}));
        if (blocked || (!scene.move?.avoiding && decision.reaction !== 'avoid')) return null;
      }
      let landing;
      if (['A','D','S'].includes(key)) {
        if (scene.feetVisible === false) return null;
        const veto = decision.decision?.source === 'veto';
        if (scene.move?.target || veto) {
          // A veto authorizes its replacement direction, never the rejected
          // destination. An ungrounded replacement holds for another image.
          if (veto && !decision.geometryLanding) return null;
          landing = encounterLanding(scene, job.effect.matches, key, veto ? decision.geometryLanding : scene.move.target);
          if (!landing) return null;
          if (veto) {
            const lateral = floorCorridor({...scene,ahead:landing.target});
            if (!lateral || scene.obstacles.some(o => o.solid !== false &&
                obstacleHits(lateral,o,.1,1,lateral.radius))) return null;
            const boots = [scene.feet.left[1],scene.feet.right[1]];
            landing.alreadyBeside = key === 'A' ? Math.max(...boots)<landing.obstacle[1] :
              key === 'D' && Math.min(...boots)>landing.obstacle[3];
          }
        }
      }
      job.lastCommandFrame = latest.frame;
      if (['A','D','S'].includes(key)) job.proposedStep={key,basis:latest.frame,scene};
      if (['A','D'].includes(key)) {
        prop.avoidRequestedAt ??= at;
        return { ...command, encounter: prop.id, reaction: 'avoid', toward: key === 'A' ? 'left' : 'right', ...(landing && {landing}) };
      }
      return { ...command, encounter: prop.id, ...(landing && {landing}) };
    },
    finish() {
      for (const job of jobs.values()) {
        if (job.closed) continue;
        job.closed = true;
        if (!job.prop.acked) {
          job.prop.placement = 'failed';
          report(job.prop, false);
        } else if (!job.prop.seen) job.prop.placement = 'unverified';
        else if (!job.prop.inPath && job.prop.placement === 'correcting') job.prop.placement = 'off-path';
      }
    },
  };
}
