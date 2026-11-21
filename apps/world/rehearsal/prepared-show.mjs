import {createReadStream, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const catalogFile = new URL('./prepared-media/catalog.json', import.meta.url);
const presetsFile = new URL('../../../fixtures/haunt/presets.json', import.meta.url);
const {clips} = JSON.parse(readFileSync(catalogFile));
const presets = JSON.parse(readFileSync(presetsFile));
// Screening plays both halves of a filmed encounter at native speed. A visible
// prop or a movement instruction alone cannot qualify an audience choice.
export function hasFilmedResponse(clip) {
  const e = clip.reactionEvidence;
  if (clip.role !== 'effect' || !e || !Number.isSafeInteger(clip.fps) || clip.fps <= 0 || e.clipSha256 !== clip.sha256 ||
      !/^[0-9a-f]{64}$/.test(clip.sha256 ?? '') || !clip.source?.episodeId || e.episodeId !== clip.source.episodeId) return false;
  const inClip = n => Number.isSafeInteger(n) && n >= 1 && n <= clip.frames;
  return e.verifiedInPixels === true && ['duck','shield','recoil','retreat','sidestep','stop'].includes(e.action) &&
    inClip(e.obstacleFrame) && inClip(e.responseFrame) && e.obstacleFrame < e.responseFrame;
}
export function buildPreparedLibrary(clips,mediaDirectory=new URL('./prepared-media/',import.meta.url)) {
  const effectOptions=[], byText=new Map();
  const walk = clips.find(c => c.role === 'walk');
  function verified(clip) {
    if (!clip?.file || !clip.sha256) return false;
    try {
      const bytes = readFileSync(new URL(clip.asset ?? clip.file,mediaDirectory));
      return createHash('sha256').update(bytes).digest('hex') === clip.sha256;
    } catch { return false; }
  }
  if (!verified(walk)) return {clips:[],effectOptions,byText};
  for (const clip of clips.filter(hasFilmedResponse)) {
    if (!verified(clip)) continue;
    const preset=presets.find(p=>p.id===clip.presetId);
    if (!preset || byText.has(preset.text)) continue;
    effectOptions.push({id:preset.id,text:preset.text,title:clip.title || preset.label,label:clip.buttonLabel || preset.label,tags:preset.tags});
    byText.set(preset.text,clip);
  }
  return {clips:[walk,...byText.values()],effectOptions,byText};
}
export const preparedLibrary=buildPreparedLibrary(clips);
export const preparedEncountersAvailable=preparedLibrary.effectOptions.length>0;
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

export function registerPreparedMedia(app, root, library=preparedLibrary) {
  for (const clip of library.clips) {
    const path = resolve(root, 'prepared-media', clip.asset ?? clip.file);
    app.get(brief(clip).clipUrl, async (req, reply) => serveMovie(path,req,reply));
  }
}

export function createPreparedShow(start, deadline, onDisplay, collectMs = 30000, onReaction=()=>{}, library=preparedLibrary) {
  const {clips,effectOptions,byText}=library;
  const walk = clips.find(c=>c.role==='walk');
  const selected = new Set();
  let opening = true, queued = null;
  let nextChange = start + collectMs;
  let pendingDisplay, pendingReaction;
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
    if (!opening) state.upNext = brief(clip);
    return true;
  }
  function advance(now) {
    if (now >= deadline) return;
    if (pendingDisplay && now >= pendingDisplay.at) {
      const {guest,at}=pendingDisplay;
      pendingDisplay=null;
      onDisplay(guest,at);
    }
    if (pendingReaction && now >= pendingReaction.at) {
      const {guest,at}=pendingReaction;
      pendingReaction=null;
      onReaction(guest,at);
    }
    if (now < nextChange) return;
    if (!opening && !queued) {
      state.phase = 'waiting';
      state.upNext = null;
      state.cue = null;
      return;
    }
    if (state.phase !== 'handoff') {
      state.phase = 'handoff';
      nextChange = now + blackoutMs;
      return;
    }
    const guest = opening ? null : queued;
    const clip = opening ? walk : guest.clip;
    if (guest) queued = null;
    opening = false;
    Object.assign(state,{phase:'playing', clipUrl:brief(clip).clipUrl, clipStartedAt:now,
      clipDurationMs:clip.durationMs, sourceTitle:clip.title, upNext:queued ? brief(queued.clip) : null,
      cue:guest ? {label:'Audience pick',text:clip.title,by:guest.by} : null});
    nextChange = now + clip.durationMs;
    if (guest) {
      const frameAt = n => now + Math.round((n-1)*1000/clip.fps);
      pendingDisplay = {guest,at:frameAt(clip.reactionEvidence.obstacleFrame)};
      pendingReaction = {guest,at:frameAt(clip.reactionEvidence.responseFrame)};
    }
  }
  return {state, gate, choose, advance};
}
