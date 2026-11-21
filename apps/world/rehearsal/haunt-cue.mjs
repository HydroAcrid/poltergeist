const intendedMove = {
  W: 'Trying to move forward', S: 'Trying to back away',
  A: 'Trying a step left', D: 'Trying a step right',
  ArrowLeft: 'Looking for a route on the left', ArrowRight: 'Looking for a route on the right',
  assess: 'Checking the path',
};

// The card follows one committed haunting from selection to its observed outcome.
function currentHaunting(round, now) {
  if (round?.phase !== 'playing') return null;
  const props = round.props || [];
  const reaction = round.lastReaction;
  if (reaction && now - (reaction.presentedAt ?? reaction.at) < 3000) {
    const prop = props.find((p) => p.reactedAt === reaction.at);
    return {reaction: true, card: {
      label: reaction.flinch ? 'The robot flinched' : 'The robot sidestepped',
      text: prop?.name || reaction.name, by: prop?.by,
    }};
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
  return {item, card: {label, text: item.name, by: item.by, ...(action ? { intent: action } : {})}};
}

export function hauntCue(round, now) {
  return currentHaunting(round, now)?.card ?? null;
}

const readIntentMs = 3500;

// Only the projector extends a caption. Dispatch decisions still see the current camera observation.
export function createProjectorCue() {
  let shown;
  return (round, now) => {
    const current = currentHaunting(round, now);
    const card = current?.card ?? null;
    if (!round?.live || round.phase !== 'playing' || current?.reaction || !round.trackedBody) {
      shown = null;
      return card;
    }
    if (card?.intent) {
      const i = round.intent;
      if (current.item.placement === 'correcting' ||
          (round.lastMoveHeld?.key === i.key && round.lastMoveHeld.observed >= i.observed)) {
        shown = null;
        const {intent, ...placement} = card;
        return placement;
      }
      if (!shown || shown.round !== round.id || shown.chapter !== round.chapter ||
          shown.id !== i.hauntId || shown.at !== i.at || shown.frame !== i.observed || shown.key !== i.key) {
        shown = {round:round.id, chapter:round.chapter, id:i.hauntId, at:i.at, frame:i.observed, key:i.key,
          label:card.label, inPath:!!current.item.inPath, until:now + readIntentMs, card};
      }
      return card;
    }
    if (!shown) return card;
    const prop = round.props?.find(p => p.id === shown.id);
    const displaced = !prop || (shown.inPath && !prop.inPath) || prop.reactedAt || prop.cueAt === null ||
      ['correcting','off-path','passed','failed','unverified'].includes(prop.placement) ||
      (current && (current.item?.id !== shown.id || card.label !== shown.label));
    const newerIntent = round.intent && round.intent.at >= shown.at &&
      (round.intent.hauntId !== shown.id || round.intent.key !== shown.key);
    const blocked = round.lastMoveHeld?.key === shown.key && round.lastMoveHeld.observed >= shown.frame;
    if (round.id !== shown.round || round.chapter !== shown.chapter || now >= shown.until || displaced || blocked || newerIntent) {
      shown = null;
      return card;
    }
    return shown.card;
  };
}
