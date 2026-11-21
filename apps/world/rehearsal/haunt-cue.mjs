const intendedMove = {
  W: 'Trying to move forward', S: 'Trying to back away',
  A: 'Trying a step left', D: 'Trying a step right',
  ArrowLeft: 'Looking for a route on the left', ArrowRight: 'Looking for a route on the right',
  assess: 'Checking the path',
};

// The card follows one committed haunting from selection to its observed outcome.
export function hauntCue(round, now) {
  if (round?.phase !== 'playing') return null;
  const props = round.props || [];
  const reaction = round.lastReaction;
  if (reaction && now - (reaction.presentedAt ?? reaction.at) < 3000) {
    const prop = props.find((p) => p.reactedAt === reaction.at);
    return {
      label: reaction.flinch ? 'The robot flinched' : 'The robot sidestepped',
      text: prop?.name || reaction.name, by: prop?.by,
    };
  }
  const intent = round.intent;
  const freshIntent = round.live && round.trackedBody && intent && intent.observed === round.observed &&
    now >= round.trackedAt && now - round.trackedAt < 3000 &&
    now >= intent.at && now - intent.at < 3000 ? intent : null;
  const pending = round.upcoming?.[0];
  const p = props.find((item) => item.selectedAt != null && item.cueAt !== null && !item.reactedAt &&
    !['off-path', 'passed', 'failed', 'unverified'].includes(item.placement) &&
    (!item.seenAt || freshIntent?.hauntId === item.id || now - (item.inPathPresentedAt ?? item.seenPresentedAt ?? item.seenAt) < 4200 || item.placement === 'correcting'));
  const item = p || (pending?.cueAt !== null ? pending : null);
  if (!item) return null;
  let label = 'Up next';
  if (item.placement === 'correcting') label = 'Finding the path';
  else if (item.inPath) label = 'In the robot’s path';
  else if (item.seen) label = 'In view';
  else if (item.sentAt != null) label = 'Taking effect';
  const action = freshIntent && freshIntent.hauntId === item.id ? intendedMove[freshIntent.key] : undefined;
  return { label, text: item.name, by: item.by, ...(action ? { intent: action } : {}) };
}
