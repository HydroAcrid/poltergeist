import {createReadStream, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

const catalogFile = new URL('./prepared-media/catalog.json', import.meta.url);
const presetsFile = new URL('../../../fixtures/haunt/presets.json', import.meta.url);
const {clips} = JSON.parse(readFileSync(catalogFile));
const presets = JSON.parse(readFileSync(presetsFile));
const byRole = role => clips.find(clip => clip.role === role);
const effectOptions = clips.filter(clip => clip.role === 'effect').map(clip => {
  const preset = presets.find(item => item.id === clip.presetId);
  return {id:preset.id, text:preset.text, title:clip.title, label:clip.buttonLabel, tags:preset.tags};
});
const byText = new Map(effectOptions.map(option => [option.text, clips.find(c => c.presetId === option.id)]));
const brief = clip => ({clipUrl:'/rehearsal/clips/' + clip.file, title:clip.title});
const blackoutMs = 1250;
const preloadLeadMs = 4000;

export function serveMovie(path,req,reply) {
  const {size} = statSync(path);
  reply.type('video/mp4').header('accept-ranges','bytes').header('cache-control','public, max-age=3600');
  const range = req.headers.range;
  if (!range) return reply.header('content-length',size).send(createReadStream(path));
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0,size - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(size-1, Number(match[2])) : size-1;
  if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || start < 0 || start > end)
    return reply.code(416).header('content-range','bytes */'+size).send();
  return reply.code(206).header('content-range',`bytes ${start}-${end}/${size}`)
    .header('content-length',end-start+1).send(createReadStream(path,{start,end}));
}

export function registerPreparedMedia(app, root) {
  for (const clip of clips) {
    const path = resolve(root, 'prepared-media', clip.file);
    app.get(brief(clip).clipUrl, async (req, reply) => serveMovie(path,req,reply));
  }
}

export function createPreparedShow(start, deadline, onDisplay, collectMs = 30000) {
  const walk = byRole('walk');
  const idle = byRole('idle');
  const selected = new Set();
  let fallback = walk, queued = null;
  let nextChange = start + collectMs;
  const state = {phase:'collecting', collectUntil:nextChange, upNext:brief(walk)};
  function gate(now) {
    return {options:effectOptions, canDispatch:!queued && state.phase !== 'handoff' &&
      now < deadline - blackoutMs && now >= nextChange - preloadLeadMs};
  }
  function choose(h, by, now) {
    const clip = byText.get(h.text);
    if (!clip || selected.has(h.hauntId) || !gate(now).canDispatch) return false;
    selected.add(h.hauntId);
    queued = {clip, id:h.hauntId, by};
    state.upNext = brief(clip);
    return true;
  }
  function advance(now) {
    if (now < nextChange || now >= deadline) return;
    if (state.phase !== 'handoff') {
      state.phase = 'handoff';
      nextChange = now + blackoutMs;
      return;
    }
    const clip = queued?.clip || fallback;
    const guest = queued;
    queued = null;
    fallback = idle;
    Object.assign(state,{phase:'playing', clipUrl:brief(clip).clipUrl, clipStartedAt:now,
      clipDurationMs:clip.durationMs, sourceTitle:clip.title, upNext:brief(fallback),
      cue:guest ? {label:'Audience pick',text:clip.title,by:guest.by} : null});
    nextChange = now + clip.durationMs;
    if (guest) onDisplay(guest,now);
  }
  return {state, gate, choose, advance};
}
