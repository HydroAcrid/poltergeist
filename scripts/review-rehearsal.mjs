// Review saved telemetry only. The final motion check uses the uncut native recording.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessFraming } from '../apps/world/painted-door/framing-report.mjs';
import { describeEffect } from '../apps/world/rehearsal/placement.mjs';

export function reviewRehearsal(session, outcome) {
  const events = session.events || [];
  const observations = events.filter(event => event.scene);
  const framing = assessFraming(events, session.frames);
  const blockers = [];
  if (!session.episodeId || session.episodeId !== outcome.id)
    blockers.push('The native recording and audience result lack a matching round ID.');
  if (!outcome.live || session.terminal !== 'completed')
    blockers.push('A completed live Genie round is required.');
  if (!observations.length || observations.some(({scene}) => !scene.visible || scene.playerCount !== 1))
    blockers.push('Single-player identity is unverified in the observed frames.');
  if (!events.some(event => event.action === 'Player applied W'))
    blockers.push('Brain never sent a forward move to the player.');
  if (framing.status !== 'within framing at sampled times')
    blockers.push('Camera framing was outside its target or had gaps.');
  const verified = (outcome.props || []).filter(prop => {
    if (!prop.acked || !prop.confirmedFrame) return false;
    const sighting = observations.find(event => event.observed === prop.confirmedFrame);
    const effect = describeEffect(prop.name);
    const firstCue = observations.find(event => event.observedAt === prop.seenAt);
    return [firstCue, sighting].every(event =>
      event?.scene.obstacles?.some(obstacle => effect.matches(obstacle.label)));

  });
  if (!verified.length) blockers.push('The first audience sighting and the in-path frame must both identify the requested effect.');
  return {blockers, framing: framing.status, observedFrames: observations.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [sessionPath, resultPath] = process.argv.slice(2);
    if (!sessionPath || !resultPath) throw Error('Provide the saved session.json and projector outcome.json.');
    const read = file => JSON.parse(readFileSync(file, 'utf8'));
    const result = reviewRehearsal(read(sessionPath), read(resultPath));
    for (const blocker of result.blockers) console.log('- ' + blocker);
    if (result.blockers.length) process.exitCode = 1;
    else console.log('Ready for footage review. Watch the same robot pass a fixed landmark, confront the visible effect and respond before the next move.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
