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
  const state = {phase:'collecting', collectUntil:start+collectMs, upNext:null, preload:[]};
  const picks = [], ready = [], assets = new Map(), seen = new Set();
  const controller = new AbortController();
  let tail = seed, sequence = 0, worker = null, terminalQueued = false, stopped = false;
  let retry = null, inFlight = null;
  let active = null, handoffAt = null, firstPickAt = null, hasPlayed = false;
  let error = null, renderMs = 0, tailFear = 0, gapStartedAt = null;
  const metrics = {attempts:0, rejected:0, generated:0, played:0, renderMs:0, footageMs:0, openingWaitMs:null,
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
    return {canDispatch:open, slots:open ? maxPicks-picks.length : 0};
  }
  function enqueue(h, by, now) {
    if (seen.has(h.hauntId)) return true;
    if (!window(now).canDispatch) return false;
    picks.push({id:h.hauntId,text:h.text,by});
    seen.add(h.hauntId);
    firstPickAt ??= now;
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
    if (worker || terminalQueued || error || !stillFits(now) || ready.length >= targetSegments) return;
    // Allow two Crowd ticks to combine picks. If the lobby is quiet the first
    // walking take can open while guests are still entering their ideas.
    if (!sequence && !picks.length && now-start < 8000) return;
    if (!retry && picks.length === 1 && now-firstPickAt < 2000) return;
    const repeated = retry !== null;
    const batch = retry ?? picks.splice(0);
    const attempt = ++sequence;
    metrics.attempts++;
    if (!repeated) firstPickAt = null;
    retry = null;
    inFlight = batch;
    const durationMs = Math.min(durationFor(batch.length), deadline-now-flickerMs);
    // A late confirmed obstacle may need one more independent camera reading.
    // The driver uses this headroom only while a real response is in flight.
    const reactionTailMs = Math.max(0,Math.min(8000,deadline-now-flickerMs-durationMs));
    const began = now;
    worker = Promise.resolve().then(() => render({seed:tail,picks:batch,durationMs,episodeId:id,
      chapter:attempt,continuation:metrics.generated > 0,initialFear:tailFear,reactionTailMs,signal:controller.signal})).then(async clip => {
      if (stopped || controller.signal.aborted) {
        await clip.dispose?.();
        return;
      }
      if (!Buffer.isBuffer(clip.finalFrame) || !clip.finalFrame.length || !clip.filePath ||
          !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
        await clip.dispose?.();
        throw Error('The render did not produce a playable continuation.');
      }
      const review = reviewSegment(clip,batch,tailFear,metrics.generated > 0);
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
      error = visual ? cause.message : 'The next hallway scene could not be generated.';
      for (const pick of batch) onReceipt(pick,false,error);
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
      handoffAt = now + flickerMs;
      state.phase = 'handoff';
      state.cue = null;
    }
    if (retry && !worker && !stillFits(now)) {
      error = 'There was no time to film a verified retry.';
      for (const pick of retry) onReceipt(pick,false,error);
      retry = null;
    }
    const openingReady = ready.length >= targetSegments ||
      (ready.length > 0 && (terminalQueued || error || (!worker && !stillFits(now))));
    if (!active && error && (!ready.length || !hasPlayed && !openingReady)) {
      end('interrupted',null);
      return;
    }
    generate(now);
    if (!active && handoffAt === null && now >= state.collectUntil &&
        openingReady) {
      state.phase = 'handoff';
      handoffAt = now + flickerMs;
    }
    if (hasPlayed && !active && handoffAt !== null && now >= handoffAt && !ready.length && gapStartedAt === null) {
      metrics.playbackGaps++;
      gapStartedAt = now;
    }
    if (!active && handoffAt !== null && now >= handoffAt && ready.length) {
      active = ready.shift();
      active.start = now;
      handoffAt = null;
      if (!hasPlayed) metrics.openingWaitMs = now-start;
      if (gapStartedAt !== null) metrics.playbackGapMs += now-gapStartedAt;
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
  async function dispose() {
    stop();
    await worker;
    await Promise.all([...assets.values()].map(clip => clip.dispose?.()));
    assets.clear();
  }
  return {state, metrics, advance, window, enqueue, stop, dispose, get busy(){return !!worker;},
    file(n){return assets.get(n)?.filePath;}, get error(){return error;}};
}
