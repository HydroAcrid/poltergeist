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
    /gust|hurricane|wind|paper|tornado/i,
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
  [/bucket|pail/i, /bucket|pail/i],
  [/flicker|blackout|lights out/i, /flicker|blackout|shadow|dark patch/i],
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
      !obstacles.some((o) => intervalHits(c, o.box, 0.12, step, c.radius * 0.6))
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
      (matches.length > before.length &&
        !before.some((prior) => sameFootprint(prior, o))),
  );
  const inPath = candidates.filter((o) =>
    intervalHits(c, o.box, 0.17, 1.45, c.radius, o.relation === 'crossing'),
  );
  const near = inPath.filter((o) =>
    intervalHits(c, o.box, 0, 0.48, c.radius * 0.72),
  );
  const otherNear = (scene.obstacles || []).some(
    (o) =>
      !candidates.includes(o) &&
      intervalHits(c, o.box, 0, 0.48, c.radius * 0.72),
  );
  return {
    visible: candidates.length > 0,
    inPath: inPath.length > 0,
    contact: near.length === 1 && !otherNear,
    soleThreat:
      inPath.length === 1 &&
      !(scene.obstacles || []).some(
        (o) => o !== inPath[0] && intervalHits(c, o.box, 0.17, 1.45, c.radius),
      ),
  };
}

export function createPlacementController(round, send, report, { cueLeadMs = 0 } = {}) {
  let latest,
    lastMove = 0,
    pauseUntil = 0,
    inspectUntil = 0;
  const jobs = new Map();
  const now = () => Date.now();

  function pauseForAssessment(time) {
    pauseUntil = time + 850;
    inspectUntil = time + 2700;
    round.action = 'Assessing the path';
    send({ pause: true });
  }
  function trySend(job, time) {
    if (time < job.prop.selectedAt + cueLeadMs || !freshObservation(latest, time, lastMove) || time >= round.deadline)
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
    job.lastChecked = null;
    pauseForAssessment(time);
    const hint =
      (retry ? 'Relocate the same haunting; keep a single instance. ' : '') +
      job.effect.hint;
    send({
      haunt: {
        id: prop.id,
        text: prop.name,
        target,
        hint,
        attempt: prop.attempt,
      },
    });
    return true;
  }
  function pump(time) {
    for (const job of jobs.values()) {
      if (job.closed) continue;
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
        name: text,
        by,
        selectedAt: time,
        attempt: 0,
        acked: false,
        seen: false,
        inPath: false,
        placement: 'waiting',
      };
      round.props.push(prop);
      jobs.set(id, { prop, effect: describeEffect(text) });
      if (cueLeadMs > 0 && [...jobs.values()].find((item) => !item.closed)?.prop === prop) {
        pauseUntil = time + cueLeadMs;
        send({ pause: true, settleCamera: true });
      }
      pump(time);
    },
    tick(time = now()) { pump(time); },
    navigationPaused(time = now()) {
      return time < Math.max(pauseUntil, inspectUntil);
    },
    moved(time = now()) {
      lastMove = time;
    },
    acknowledged(id, attempt, at, frame) {
      const job = jobs.get(id);
      if (
        !job ||
        job.closed ||
        attempt !== job.prop.attempt ||
        job.ackTime != null
      )
        return;
      const p = job.prop;
      job.ackTime = at;
      job.ackFrame = frame;
      p.placement = 'acknowledged';
      if (!p.acked) {
        p.acked = true;
        report(p, true);
      }
    },
    failed(id, attempt) {
      const job = jobs.get(id);
      if (!job || job.closed || job.prop.attempt !== attempt) return;
      job.closed = true;
      inspectUntil = 0;
      job.prop.placement = job.prop.acked ? 'unverified' : 'failed';
      if (!job.prop.acked) report(job.prop, false);
    },
    observe(scene, frame, at, time = now()) {
      if (!Number.isFinite(at) || (latest && frame <= latest.frame)) return;
      latest = { scene, frame, at, received: time };
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
        if (result && freshObservation(latest, time)) {
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
            inspectUntil = 0;
            p.assessment = ['ordinary', 'startling'].includes(scene.threat)
              ? scene.threat
              : 'unclear';
            if (
              result.soleThreat &&
              scene.threat === 'startling' &&
              scene.pose === 'upright' &&
              !p.reactionRequestedAt &&
              freshObservation(latest, time, lastMove)
            ) {
              // An animation request is an intention. Only a subsequent, independent
              // visible change in pose can contribute to the fear meter.
              p.reactionRequestedAt = time;
              pauseUntil = time + 850;
              send({ pause: true });
              send({ reaction: 'startle' });
            }
            const visibleStumble = result.contact && scene.pose === 'stumbling';
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
              round.fear++;
              round.lastReaction = { at, presentedAt: time, name: p.name, flinch: true };
            }
            // Keep tracking the verified object until contact or the robot passes.
            // Sending a second hazard into the same encounter blurs attribution.
            if (p.reactedAt) job.closed = true;
            job.wasInPath = true;
          } else if (job.wasInPath) {
            job.closed = true;
            p.placement = 'passed';
          } else if (at - job.ackTime >= 1000) {
            const nearby = result.visible && scene.obstacles.find((o) =>
              o.relation === 'noticeable' && job.effect.matches(o.label) && box(o.box));
            if (nearby && !p.noticeRequestedAt && scene.pose === 'upright') {
              const feetX = (scene.feet.left[1] + scene.feet.right[1]) / 2;
              const toward = (nearby.box[1] + nearby.box[3]) / 2 < feetX ? 'left' : 'right';
              p.noticeRequestedAt = time;
              send({ reaction: 'notice', toward });
            }
            if (p.attempt === 1 && round.deadline - time > 1800) {
              p.placement = 'correcting';
              job.ackTime = null;
              if (cueLeadMs > 0) {
                pauseUntil = time + 1800;
                send({ pause: true, settleCamera: true });
              }
            } else {
              p.placement = result.visible ? 'off-path' : 'unverified';
              job.closed = true;
            }
          }
          job.previousPose = scene.pose;
        }
      }
      pump(time);
    },
    characterCommand(decision, at = now()) {
      const command = { key: decision.action.key, ms: decision.action.holdMs };
      const prop = [...jobs.values()].find((job) => !job.closed && job.prop.inPath)?.prop;
      if (!prop || !['A', 'D'].includes(command.key) || prop.avoidRequestedAt) return command;
      prop.avoidRequestedAt = at;
      return { ...command, reaction: 'avoid', toward: command.key === 'A' ? 'left' : 'right' };
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
