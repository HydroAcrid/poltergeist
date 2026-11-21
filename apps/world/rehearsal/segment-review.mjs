// Review sealed native footage before the projector or the next generator can use it.
export function reviewSegment(clip, picks, initialFear, continuation) {
  const {evidence = {}, frameCount, fps, durationMs} = clip;
  const observations = evidence.observations ?? [];
  const observed = new Map(observations.map(s => [s.frame,s]));
  const frame = n => Number.isInteger(n) && n >= 1 && n <= frameCount;
  const offset = n => Number.isFinite(n) && n >= 0 && n < durationMs;
  const clearView = s => s?.visible === true && s.playerCount === 1 &&
    s.shoulderView === 'rear-right' && s.feetVisible === true;
  const tracked = s => clearView(s) && s.subjectTracked === true;
  const compared = s => clearView(s) && (s.subjectTracked === true || s.subjectCompared === true);
  const reject = reason => ({ok:false,reason});
  if (evidence.continuity?.matches === false || (continuation && evidence.continuity?.matches !== true))
    return reject('The next scene opened in a different view of the hallway.');
  const last = observations.at(-1);
  if (!Number.isInteger(frameCount) || !Number.isFinite(fps) || fps <= 0 ||
      !frame(last?.frame) || frameCount-last.frame > fps*4 || !tracked(last))
    return reject('The camera lost a clear right-shoulder view of the explorer at the cut.');

  const receipts = [], missing = [];
  const unplaced = 'The camera did not confirm the idea in the walking path.';
  let fear = initialFear;
  for (const pick of picks) {
    const matches = evidence.picks?.filter(p => p.id === pick.id) ?? [];
    const p = matches[0];
    if (!p || (matches.length === 1 && !p.visible && !p.inPath && !p.reacted && !p.response)) {
      missing.push(pick);
      continue;
    }
    if (matches.length !== 1 || !p.delivered || !p.visible || !p.inPath ||
        !frame(p.inPathFrame) || !offset(p.inPathOffsetMs) || !tracked(observed.get(p.inPathFrame)))
      return reject(unplaced);
    const step = p.response;
    const measuredStep = step && frame(step.basis) && step.basis >= p.inPathFrame &&
      frame(step.appliedFrame) && step.appliedFrame >= step.basis &&
      frame(step.checkedFrame) && step.checkedFrame > step.appliedFrame &&
      compared(observed.get(step.checkedFrame)) && evidence.moves?.some(m =>
        m.key === step.key && m.observed === step.basis && m.appliedFrame === step.appliedFrame);
    const bypass = measuredStep && ['A','D'].includes(step.key) && step.outcome === 'route-open' &&
      p.reacted === true && p.reaction === 'sidestep' && p.reactedFrame === step.checkedFrame;
    const retreat = measuredStep && step.key === 'S' && step.outcome === 'backed-away';
    const scare = p.reacted === true && p.scare === true && p.reaction === 'scare' &&
      frame(p.reactedFrame) && p.reactedFrame > p.inPathFrame && tracked(observed.get(p.reactedFrame)) &&
      offset(p.reactedOffsetMs) && p.reactedOffsetMs > p.inPathOffsetMs;
    if (!bypass && !retreat && !scare)
      return reject('The camera did not confirm how the explorer reacted to the idea.');
    if (scare) fear++;
    receipts.push({pick,at:p.inPathOffsetMs,scareAt:scare ? p.reactedOffsetMs : null,reaction:p.reaction});
  }
  if (evidence.finalFear !== fear)
    return reject('The filmed reactions did not match the recorded fear score.');
  const winner = evidence.winner;
  if (winner === 'robot') {
    const finish = observed.get(evidence.winnerFrame);
    const threshold = observations.filter(s => s.frame < evidence.winnerFrame &&
      s.doorwayProgress === 'at-threshold' && tracked(s)).at(-1);
    const stepped = threshold && evidence.moves?.some(m => m.key === 'W' && frame(m.appliedFrame) &&
      m.appliedFrame >= threshold.frame && m.appliedFrame < evidence.winnerFrame);
    if (!tracked(finish) || finish.doorwayProgress !== 'through' || !stepped)
      return reject('The camera did not confirm the explorer crossing the exit.');
  } else if (winner === 'audience') {
    if (fear < 3 || !frame(evidence.winnerFrame) ||
        !evidence.picks.some(p => p.reaction === 'scare' && p.reactedFrame === evidence.winnerFrame) || !tracked(observed.get(evidence.winnerFrame)))
      return reject('The last scare was not confirmed on camera.');
  } else if (winner != null || fear >= 3) return reject('The filmed ending was unclear.');
  const winnerAt = winner ? Math.round(((clip.openingHoldFrames ?? 0)+evidence.winnerFrame-1)*1000/fps) : null;
  if (winner && !offset(winnerAt)) return reject('The filmed ending was outside the recording.');
  if (missing.length && !receipts.length && !winner) return reject(unplaced);
  return {ok:true,receipts,missing,unplaced,finalFear:fear,winner,winnerAt};
}
