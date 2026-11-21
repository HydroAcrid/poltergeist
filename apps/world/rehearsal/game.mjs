// The projector is a subscriber. The round keeps advancing when a screen reloads.
export const openingMs = 30000;
export const playMs = 72000;
export const fearLimit = 3;

export const effects = [
  ['peel', /banana|peel/i, 'Banana peel', 'dodge'],
  ['chair', /chair|seat/i, 'Overturned chair', 'dodge'],
  ['bucket', /bucket/i, 'Rolling bucket', 'dodge'],
  ['marbles', /marble/i, 'Loose marbles', 'dodge'],
  ['papers', /paper|gust|wind/i, 'Paper storm', 'flinch'],
  ['fog', /fog|mist/i, 'Fog bank', 'flinch'],
  ['lights', /flicker|lights|power|blackout/i, 'Lights out', 'flinch'],
  ['balloons', /balloon/i, 'Drifting balloons', 'flinch'],
  ['decoy', /paint|fake door/i, 'Painted exit', 'dodge'],
];

export function newRound(id, now) {
  return {
    id,
    phase: 'opening',
    openedAt: now,
    deadline: now + openingMs,
    startedAt: 0,
    depth: 0,
    lane: 0,
    fear: 0,
    props: [],
    action: 'waiting',
    lastReaction: null,
    winner: null,
    reason: null,
    finishedAt: 0,
    seq: 0,
  };
}

export function beginPlay(round, now) {
  if (round.phase !== 'opening' || now < round.deadline) return false;
  Object.assign(round, {
    phase: 'playing',
    startedAt: now,
    deadline: now + playMs,
    action: 'walking',
  });
  return true;
}

export function finish(round, winner, reason, now) {
  const closedLobby = round.playMode === 'buffered-live' && round.phase === 'preparing' && reason === 'interrupted';
  if (round.phase !== 'playing' && !closedLobby) return;
  Object.assign(round, {
    phase: 'ended',
    winner,
    reason,
    finishedAt: now,
    action: 'stopped',
  });
}

export function place(round, pick, now) {
  const effect = effects.find(([, match]) => match.test(pick.text));
  if (
    !effect ||
    round.phase !== 'playing' ||
    round.depth > 0.95 ||
    round.props.some((prop) => prop.id === pick.hauntId)
  )
    return false;
  const [kind, , name, response] = effect;
  round.props.push({
    id: pick.hauntId,
    kind,
    name,
    response,
    placedAt: now,
    depth: Math.min(0.98, round.depth + 0.078),
    lane: round.lane,
    reactedAt: 0,
  });
  return true;
}

export function observe(round) {
  if (round.depth >= 1) return { frame: 'arrived' };
  const prop = round.props.find(
    (p) => !p.reactedAt && p.depth - round.depth <= 0.045,
  );
  if (prop)
    return {
      frame: prop.response === 'flinch' ? 'stumbling' : 'peel-in-path',
      id: prop.id,
    };
  return { frame: 'clear-aisle' };
}

// Score only the action applied to the same observed encounter; a submission,
// injection, later tick, or ordinary dodge cannot award a fear point.
export function applyDecision(round, observation, decision, now) {
  if (round.phase !== 'playing') return;
  if (now >= round.deadline) return finish(round, 'audience', 'time', now);
  const prop = round.props.find((p) => p.id === observation.id && !p.reactedAt);
  const key = decision.action.key;
  if (
    prop &&
    ((prop.response === 'flinch' &&
      key === 'NOOP' &&
      decision.mode === 'unstick') ||
      (prop.response === 'dodge' && (key === 'A' || key === 'D')))
  ) {
    const flinch = prop.response === 'flinch';
    prop.reactedAt = now;
    prop.observedReaction = flinch ? 'scare' : 'sidestep';
    if (flinch) round.fear++;
    else
      round.lane = Math.max(
        -1,
        Math.min(1, round.lane + (key === 'A' ? -0.55 : 0.55)),
      );
    round.action = flinch ? 'flinched' : 'sidestepped';
    round.lastReaction = { at: now, name: prop.name, flinch, key };
    if (round.fear >= fearLimit) finish(round, 'audience', 'fear', now);
    return;
  }
  if (decision.successClaim && round.depth >= 1)
    return finish(round, 'robot', 'exit', now);
  if (key === 'W') {
    // 3 bays, each taking about 15 seconds of unobstructed walking.
    round.depth = Math.min(1, round.depth + decision.action.holdMs / 45000);
    round.lane *= 0.94;
    round.action = 'walking';
  }
}
