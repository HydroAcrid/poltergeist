// Generate sequentially from the preceding segment's native JPEG. Playback may
// run concurrently with generation, but two generators can never fork the hallway.
const flickerMs = 1250;
const collectMs = 30000;
const maxPicks = 2;
const targetSegments = 2;
const minimumTakeMs = 16000;
const durationFor = count => minimumTakeMs + count * 8000;

export function createBufferedShow({id, seed, start, deadline, render, onReceipt, onFinish, onScare = () => {}, clock = Date.now}) {
  const state = {phase:'collecting', collectUntil:start+collectMs, upNext:null};
  const picks = [], ready = [], assets = new Map(), seen = new Set();
  const controller = new AbortController();
  let tail = seed, sequence = 0, worker = null, terminalQueued = false, stopped = false;
  let active = null, handoffAt = null, firstPickAt = null, hasPlayed = false;
  let error = null, renderMs = 0, tailFear = 0, gapStartedAt = null;
  const metrics = {generated:0, played:0, renderMs:0, footageMs:0, openingWaitMs:null,
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
      if (entry.ok) state.cue = {label:'In the hallway',text:entry.pick.text,by:entry.pick.by};
      onReceipt(entry.pick,entry.ok,entry.ok ? undefined : 'The camera did not confirm this idea in the walking path.');
    }
  }
  function releasePending(reason) {
    for (const pick of picks.splice(0)) onReceipt(pick,false,reason);
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
    if (picks.length === 1 && now-firstPickAt < 2000) return;
    const batch = picks.splice(0), n = ++sequence;
    firstPickAt = null;
    const durationMs = Math.min(durationFor(batch.length), deadline-now-flickerMs);
    const began = now;
    worker = Promise.resolve().then(() => render({seed:tail,picks:batch,durationMs,episodeId:id,
      chapter:n,initialFear:tailFear,signal:controller.signal})).then(clip => {
      if (stopped || controller.signal.aborted) {
        clip.dispose?.();
        for (const pick of batch) onReceipt(pick,false,'The round ended before this idea appeared.');
        return;
      }
      if (!Buffer.isBuffer(clip.finalFrame) || !clip.finalFrame.length || !clip.filePath ||
          !Number.isFinite(clip.durationMs) || clip.durationMs <= 0) {
        clip.dispose?.();
        throw Error('The render did not produce a playable continuation.');
      }
      tail = clip.finalFrame;
      tailFear = clip.evidence?.finalFear ?? tailFear;
      renderMs = Math.max(0,clock()-began);
      metrics.generated++;
      metrics.renderMs += renderMs;
      metrics.footageMs += clip.durationMs;
      const receipts = batch.map(pick => {
        const observation = clip.evidence?.picks?.find(e => e.id === pick.id);
        const at = observation?.inPathOffsetMs;
        const ok = observation?.inPath === true && Number.isFinite(at) && at >= 0 && at <= clip.durationMs;
        return {pick,ok,at:ok ? at : clip.durationMs,done:false,
          scareAt:ok && observation?.scare === true ? observation.reactedOffsetMs : null,
          reaction:observation?.reaction};
      });
      const segment = {n,clip,receipts,title:batch.length ? 'The next haunting' : 'Follow the flashlight'};
      assets.set(n,clip);
      ready.push(segment);
      if (clip.evidence?.winner) terminalQueued = true;
      state.upNext = brief(ready[0]);
    }).catch(() => {
      for (const pick of batch) onReceipt(pick,false,'The next scene could not be generated.');
      if (!stopped) error = 'The next hallway scene could not be generated.';
    }).finally(() => { worker = null; });
  }
  function advance(now) {
    if (stopped) return;
    if (active) announce(active,Math.min(active.clip.durationMs,Math.max(0,now-active.start)));
    if (now >= deadline) {
      end(hasPlayed ? 'time' : 'interrupted',hasPlayed ? 'audience' : null);
      return;
    }
    if (active && now >= active.start+active.clip.durationMs) {
      if (active.clip.evidence?.winner) {
        const winner = active.clip.evidence.winner;
        end(winner === 'robot' ? 'exit' : 'fear',winner);
        return;
      }
      active = null;
      handoffAt = now + flickerMs;
      state.phase = 'handoff';
      state.cue = null;
    }
    if (!active && !ready.length && error) { end('interrupted',null); return; }
    generate(now);
    if (!active && handoffAt === null && now >= state.collectUntil &&
        (ready.length >= targetSegments || ready.length && (worker || terminalQueued || error || !stillFits(now)))) {
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
        upNext:ready.length ? brief(ready[0]) : null});
      announce(active,0);
    }
    if (!hasPlayed && !worker && !ready.length && !stillFits(now)) end('interrupted',null);
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
