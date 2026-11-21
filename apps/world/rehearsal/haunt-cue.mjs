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
  const pending = round.upcoming?.[0];
  const p = props.find((item) => item.selectedAt != null && !item.reactedAt &&
    !['off-path', 'passed', 'failed', 'unverified'].includes(item.placement) &&
    (!item.seenAt || now - (item.inPathPresentedAt ?? item.seenPresentedAt ?? item.seenAt) < 4200 || item.placement === 'correcting'));
  const item = p || pending;
  if (!item) return null;
  let label = 'Up next';
  if (item.placement === 'correcting') label = 'Finding the path';
  else if (item.inPath) label = 'In the robot’s path';
  else if (item.seen) label = 'In view';
  else if (item.sentAt != null) label = 'Taking effect';
  return { label, text: item.name, by: item.by };
}
