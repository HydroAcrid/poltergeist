// Generate sequentially from the preceding segment's native JPEG. Playback may
// run concurrently with generation, but two generators can never fork the hallway.
import {reviewSegment} from './segment-review.mjs';

const flickerMs = 1250;
const collectMs = 30000;
const maxPicks = 2;
const targetSegments = 2;
const minimumTakeMs = 16000;
const durationFor = count => minimumTakeMs + count * 8000;

export function createBufferedShow({id, seed, start, deadline, render, onReceipt, onFinish, onScare = () => {}, clock = Date.now}) {
  const state = {phase:'collecting', collectUntil:start+collectMs, upNext:null, preload:[], canStart:false, renderPaused:false};
  const picks = [], ready = [], assets = new Map(), seen = new Set();
  const controller = new AbortController();
  let tail = seed, sequence = 0, worker = null, terminalQueued = false, stopped = false;
  const durationMs = deadline-start;
  deadline = Infinity; // The host starts the game clock after the two scenes have been filmed.
  let retry = null, inFlight = null;
  let active = null, handoffAt = null, firstPickAt = null, hasPlayed = false;
  let error = null, renderMs = 0, tailFear = 0, gapStartedAt = null;
  const metrics = {firstPickMs:null, firstRenderMs:null, attempts:0, rejected:0, generated:0, played:0, renderMs:0, footageMs:0, openingWaitMs:null,
    playbackGaps:0, playbackGapMs:0};
  const url = n => '/rehearsal/segments/'+encodeURIComponent(id)+'/'+n+'.mp4';
  const brief = segment => ({clipUrl:url(segment.n),title:segment.title});
  function stillFits(now) {
    const activeLeft = active ? Math.max(0, active.start + active.clip.durationMs-now) : 0;
    const readyMs = ready.reduce((sum,s) => sum+s.clip.durationMs+flickerMs,0);
    return deadline-now > Math.max(minimumTakeMs,renderMs,activeLeft+readyMs)+flickerMs;
  }
  function window(now) {
    const open = !stopped && !terminalQueued && !error && stillFits(now) && picks.length < maxPicks;
    return {warming:deadline === Infinity,canDispatch:open, slots:open ? maxPicks-picks.length : 0};
  }
  function enqueue(h, by, now) {
    if (seen.has(h.hauntId)) return true;
    if (!window(now).canDispatch) return false;
    picks.push({id:h.hauntId,text:h.text,by});
    seen.add(h.hauntId);
    firstPickAt ??= now;
    metrics.firstPickMs ??= now-start;
    return true;
  }
  function announce(segment, elapsed) {
    for (const entry of segment.receipts) {
      if (!entry.scored && Number.isFinite(entry.scareAt) && elapsed >= entry.scareAt) {
        entry.scored = true;
        onScare(entry.pick,entry.reaction);
      }
      if (entry.done || elapsed < entry.at) continue;
      entry.done = true;
      state.cue = {label:'In the hallway',text:entry.pick.text,by:entry.pick.by};
      onReceipt(entry.pick,true);
    }
  }
  function releasePending(reason) {
    const pending = [...picks.splice(0), ...(retry ?? []), ...(inFlight ?? [])];
    retry = inFlight = null;
    for (const pick of pending) onReceipt(pick,false,reason);
    for (const segment of [...ready,...(active ? [active] : [])])
      for (const entry of segment.receipts) if (!entry.done) {
        entry.done = true;
        onReceipt(entry.pick,false,reason);
      }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    releasePending('The round ended before this idea appeared.');
  }
  function end(reason,winner) {
    stop();
    onFinish(reason,winner);
  }
  function generate(now) {
    if (worker || terminalQueued || error || !stillFits(now)) return;
    if (ready.length >= targetSegments) return;
    // Leave an empty room open for submissions without spending on generic walking.
    if (!retry && !picks.length) return;
    if (!retry && picks.length === 1 && now-firstPickAt < 2000) return;
    const repeated = retry !== null;
    // Give each opening scene a real idea. Two guests can open the show;
    // later arrivals can join the second scene as a compatible pair.
    const batch = retry ?? picks.splice(0,assets.size ? maxPicks : 1);
    const attempt = ++sequence;
    metrics.attempts++;
    metrics.firstRenderMs ??= now-start;
    if (!repeated && !picks.length) firstPickAt = null;
    retry = null;
    inFlight = batch;
    const durationMs = Math.min(durationFor(batch.length), deadline-now-flickerMs);
    // A late confirmed obstacle may need one more independent camera reading.
    // The driver uses this headroom only while a real response is in flight.
    const reactionTailMs = Math.max(0,Math.min(8000,deadline-now-flickerMs-durationMs));
    const began = now;
    worker = Promise.resolve().then(() => render({seed:tail,picks:batch,durationMs,episodeId:id,
      chapter:attempt,continuation:assets.size > 0,initialFear:tailFear,reactionTailMs,signal:controller.signal})).then(async clip => {
      if (stopped || controller.signal.aborted) {
        await clip.dispose?.();
        return;
      }
      if (!Buffer.isBuffer(clip.finalFrame) || !clip.finalFrame.length || !clip.filePath ||
          !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
        await clip.dispose?.();
        throw Error('The render did not produce a playable continuation.');
      }
      const review = reviewSegment(clip,batch,tailFear,assets.size > 0);
      if (!review.ok) {
        await clip.dispose?.();
        const failure = Error(review.reason);
        failure.code = 'VISUAL_REJECTION';
        throw failure;
      }
      tail = clip.finalFrame;
      tailFear = review.finalFear;
      renderMs = Math.max(0,clock()-began);
      metrics.renderMs += renderMs;
      metrics.footageMs += clip.durationMs;
      const n = ++metrics.generated;
      const segment = {n,clip,receipts:review.receipts,winner:review.winner,winnerAt:review.winnerAt,
        title:review.receipts[0]?.pick.text || 'Follow the flashlight'};
      assets.set(n,clip);
      ready.push(segment);
      inFlight = null;
      for (const missing of review.missing) onReceipt(missing,false,review.unplaced);
      if (segment.winner) terminalQueued = true;
      state.upNext = brief(ready[0]);
      state.preload = ready.slice(0,targetSegments).map(brief);
    }).catch(cause => {
      if (stopped) return;
      inFlight = null;
      renderMs = Math.max(0,clock()-began);
      const visual = cause?.code === 'HALLWAY_MISMATCH' || cause?.code === 'VISUAL_REJECTION';
      if (visual) {
        metrics.rejected++;
        if (!repeated && stillFits(clock())) {
          retry = batch;
          return;
        }
      }
      const reason = visual || cause?.code === 'VISUAL_REVIEW_UNAVAILABLE' ? cause.message : 'The next hallway scene could not be generated.';
      if (deadline === Infinity) {
        if (visual) {
          for (const pick of batch) onReceipt(pick,false,reason);
          return; // Keep checked scenes and let other audience ideas fill the opening.
        }
        retry = batch;
        state.renderPaused = true; // Only a host retry may spend on this provider failure.
      } else {
        for (const pick of batch) onReceipt(pick,false,reason);
      }
      error = reason;
    }).finally(() => { worker = null; });
  }
  function advance(now) {
    if (stopped) return;
    if (active) {
      const playedMs = Math.min(active.clip.durationMs,Math.max(0,Math.min(now,deadline)-active.start));
      announce(active,playedMs);
      if (active.winner && playedMs >= active.winnerAt) {
        end(active.winner === 'robot' ? 'exit' : 'fear',active.winner);
        return;
      }
    }
    if (now >= deadline) {
      end(hasPlayed ? 'time' : 'interrupted',hasPlayed ? 'audience' : null);
      return;
    }
    if (active && now >= active.start+active.clip.durationMs) {
      active = null;
      state.cue = null;
      if (ready.length) {
        handoffAt = now + flickerMs;
        state.phase = 'handoff';
      } else {
        handoffAt = null;
        state.phase = 'waiting';
        gapStartedAt = now;
        metrics.playbackGaps++;
      }
    }
    if (retry && !worker && !stillFits(now)) {
      error = 'There was no time to film a verified retry.';
      for (const pick of retry) onReceipt(pick,false,error);
      retry = null;
    }
    const openingReady = ready.length >= targetSegments || (terminalQueued && ready.length > 0);
    if (deadline !== Infinity && !active && error && (!ready.length || !hasPlayed && !openingReady)) {
      end('interrupted',null);
      return;
    }
    generate(now);
    if (deadline === Infinity) {
      state.canStart = now >= state.collectUntil && openingReady;
      return;
    }
    if (!active && handoffAt === null && hasPlayed && ready.length) {
      state.phase = 'handoff';
      handoffAt = now + flickerMs;
    }
    if (!active && handoffAt !== null && now >= handoffAt && ready.length) {
      active = ready.shift();
      active.start = now;
      handoffAt = null;
      if (!hasPlayed) metrics.openingWaitMs = now-start;
      if (gapStartedAt !== null) metrics.playbackGapMs += Math.max(0,now-gapStartedAt-flickerMs);
      gapStartedAt = null;
      hasPlayed = true;
      metrics.played++;
      Object.assign(state,{phase:'playing',clipUrl:url(active.n),clipStartedAt:now,
        clipDurationMs:active.clip.durationMs,sourceTitle:active.title,cue:null,
        upNext:ready.length ? brief(ready[0]) : null,preload:ready.slice(0,targetSegments).map(brief)});
      announce(active,0);
    }
    if (!hasPlayed && !worker && !openingReady && !stillFits(now)) end('interrupted',null);
  }
  function resume() {
    if (stopped || !state.renderPaused) return false;
    state.renderPaused = false;
    error = null;
    return true;
  }
  function play(now) {
    if (stopped || deadline !== Infinity || !state.canStart) return false;
    deadline = now + durationMs;
    state.canStart = false;
    handoffAt = now + flickerMs;
    state.phase = 'handoff';
    return true;
  }
  async function dispose() {
    stop();
    await worker;
    await Promise.all([...assets.values()].map(clip => clip.dispose?.()));
    assets.clear();
  }
  return {state, metrics, advance, play, resume, window, enqueue, stop, dispose, get busy(){return !!worker;},
    file(n){return assets.get(n)?.filePath;}, get error(){return error;}};
}
