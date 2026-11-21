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
