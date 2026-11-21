// Host-only diagnostics use the same private receipt and World observation as the phone and stage.
export function readiness(state) {
  if (!state) return 'Connecting to the host…';
  const round = state.round;
  if (round && round.phase !== 'ended') {
    if (!round.live) return 'Offline rehearsal · simulated hallway and responses';
    return round.phase === 'playing' ? 'Genie 4 live' : 'Opening Genie 4…';
  }
  if (state.providerClosing) return 'Finishing the previous Genie session…';
  if (!state.canLive) return 'Offline host · simulated hallway and responses';
  if (state.plateError) return 'Photo preparation needs another try';
  if (state.platePreparing) return 'Preparing your photo for Genie…';
  return state.plateReady ? 'Ready for a live Genie 4 round' : 'Waiting for a prepared photo';
}

function plannedMode(round) {
  return round.playMode || (!round.live ? 'offline-rehearsal' : !round.chapters ? 'camera-test' :
    round.clockMode === 'wall' ? 'five-minute-demo' : 'ten-minute-game');
}

export function modeLabel(round) {
  const mode = plannedMode(round);
  if (mode === 'camera-test' && round.plannedDurationMs)
    return Math.round(round.plannedDurationMs / 1000) + '-second camera test';
  return ({'camera-test':'Camera test','five-minute-demo':'5-minute demo',
    'ten-minute-game':'10 minutes of play','offline-rehearsal':'Offline rehearsal'})[mode] || 'Game';
}

export function endReason(round) {
  if (round.reason === 'interrupted' && round.stopDetail) return round.stopDetail;
  return ({exit:'The robot reached the exit.', fear:'Three scares stopped the robot.',
    time:'Time ran out.', interrupted:'The round was interrupted.'})[round.reason] || 'The round ended.';
}

export function roundStatus(round) {
  if (round.phase === 'handoff') return 'The lights are out while the next hallway opens.';
  if (round.phase === 'playing') return round.live ? 'The robot is in the hallway.' : 'Offline rehearsal in progress.';
  return round.requestedAt ? 'Request received. Opening the hallway…' : 'Opening the hallway…';
}

export function runReport(round, now, hostname) {
  const start = round.requestedAt || round.openedAt;
  const elapsed = start && (round.finishedAt || now) >= start ? Math.round(((round.finishedAt || now)-start)/1000) : null;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const report = {
    mode: plannedMode(round), plannedDurationMs: round.plannedDurationMs ?? round.durationMs ?? null,
    host: local ? 'local' : 'hosted', roundId: round.id, chapter: round.chapter ?? null, elapsedSeconds: elapsed,
    phase: round.phase, winner: round.winner ?? null, reason: round.reason ?? null,
    ...(round.stopDetail ? {detail:round.stopDetail} : {}),
  };
  for (const key of ['lastMoveProposed', 'lastMoveApplied', 'lastMoveHeld']) {
    const move = round[key];
    if (move) report[key] = {observed: move.observed, key: move.key, reason: move.reason};
  }
  return JSON.stringify(report, null, 2);
}

export function privateReceipt(receipt) {
  if (!receipt) return 'Waiting for your receipt…';
  if (receipt.status === 'rejected') return receipt.moderated?.reason || 'Please revise this idea.';
  const labels = {
    submitted: 'Checking your idea…', approved: 'Approved', queued: 'Waiting in the queue',
    withdrawn: 'Replaced by your newer idea', dispatched: 'Selected for the hallway', injected: 'Delivered to World', failed: 'Could not place this idea',
  };
  const label = labels[receipt.status] || 'Waiting for an update';
  return receipt.moderated?.safe && receipt.moderated.text
    ? label + ' · ' + receipt.moderated.text : label;
}

export function observations(round, hauntId, now) {
  const prop = round?.props?.find(item => item.id === hauntId);
  const fresh = round?.trackedAt != null && now - round.trackedAt < 5000;
  let pose = 'Simulated';
  if (round?.live) {
    const recorded = fresh || round.phase === 'ended';
    pose = recorded && round.trackedPose ? round.trackedPose : 'No clear sighting';
  }
  const placementLabels = {
    failed: 'Placement failed', 'off-path': 'Outside the path', passed: 'Left the walking path',
    unverified: 'Placement unconfirmed', correcting: 'Adjusting placement',
  };
  const placement = !prop ? 'Awaiting selection' : placementLabels[prop.placement] ||
    (prop.inPath ? 'In the walking path' : prop.seen ? 'Visible in the hallway' :
      prop.acked ? 'Delivered, awaiting sighting' : prop.sentAt ? 'Sending to the hallway' : 'Selected');
  const matching = prop?.reactedAt && round.lastReaction?.at === prop.reactedAt ? round.lastReaction : null;
  const response = matching ? matching.flinch ? 'Flinched' : 'Sidestepped' :
    prop?.reactedAt ? 'Reaction confirmed' : 'No confirmed reaction';
  const held = round?.lastMoveHeld;
  const instruction = held && held.observed === round.observed
    ? `Frame ${held.observed} · held ${held.key} · ${held.reason}`
    : round?.seq ? round.action : 'Awaiting a decision';
  return { pose, instruction, placement, response };
}
