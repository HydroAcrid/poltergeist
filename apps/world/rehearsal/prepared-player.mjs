const closeMs = 580;

export function usesClipPlayer(round) {
  return round?.playMode === 'prepared-show' || round?.playMode === 'buffered-live';
}

export function preparedTime(now, start, segmentMs, videoSeconds) {
  const elapsed = Math.max(0, (now - start) / 1000);
  const limit = Math.min(Number.isFinite(videoSeconds) ? videoSeconds : Infinity,
    segmentMs > 0 ? segmentMs / 1000 : Infinity);
  return Math.min(elapsed, Math.max(0, limit - .05));
}

// Native video owns playback. World owns the clock, scene selection and blackout boundaries.
export function createPreparedPlayer(surface) {
  const slots = [...surface.querySelectorAll('video')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let roundId, segment, visible, darkAt = 0, lastSeek = 0;
  function cover(value) {
    if (surface.dataset.cover !== value) surface.dataset.cover = value;
  }
  function reset() {
    for (const v of slots) {
      v.pause();
      v.hidden = true;
      if (v.hasAttribute('src')) { v.removeAttribute('src'); v.load(); }
      delete v.dataset.failed;
    }
    roundId = segment = visible = undefined;
    darkAt = lastSeek = 0;
    surface.hidden = true;
    cover('clear');
  }
  function source(url, preserve) {
    if (!url) return null;
    const existing = slots.find(v => v.getAttribute('src') === url);
    if (existing) return existing;
    const v = slots.find(v => v !== visible && v !== preserve);
    if (!v) return null;
    v.pause();
    v.hidden = true;
    delete v.dataset.failed;
    delete v.dataset.retryAt;
    v.src = url;
    v.load();
    return v;
  }
  function blackout(now) {
    if (surface.dataset.cover === 'closing' || surface.dataset.cover === 'dark') return;
    darkAt = now + (reduced.matches ? 120 : closeMs);
    cover('closing');
  }
  function show(round, now) {
    if (!usesClipPlayer(round)) {
      if (roundId !== undefined) reset();
      return null;
    }
    if (round.id !== roundId) {
      reset();
      roundId = round.id;
      surface.hidden = false;
    }
    if (round.phase === 'ended') {
      for (const v of slots) if (!v.paused) v.pause();
      return {};
    }
    const part = round.prepared || {};
    const fresh = round.playMode === 'buffered-live';
    if (part.phase === 'collecting') {
      if (visible) { visible.pause(); visible.hidden = true; visible = undefined; }
      segment = undefined;
      cover('clear');
      source(part.upNext?.clipUrl);
      if (fresh && Number.isFinite(part.collectUntil) && now >= part.collectUntil)
        return {message:'Preparing the first Genie scene…'};
      return {collecting:true};
    }
    if (part.phase === 'handoff') {
      if (!segment && !visible) {
        source(part.upNext?.clipUrl);
        return {message:fresh ? 'Preparing the first scene…' : 'Loading the first scene…'};
      }
      blackout(now);
      if (now >= darkAt) {
        cover('dark');
        visible?.pause();
      }
      source(part.upNext?.clipUrl);
      return {handoff:true, fresh};
    }
    const url = part.clipUrl;
    if (part.phase !== 'playing' || !url || !Number.isFinite(part.clipStartedAt)) {
      if (visible) blackout(now);
      return {message:fresh ? 'Preparing the next scene…' : 'Waiting for the next scene…'};
    }
    const key = url + '/' + part.clipStartedAt;
    if (key !== segment) {
      blackout(now);
      segment = key;
      lastSeek = 0;
    }
    const v = source(url);
    if (part.upNext?.clipUrl && part.upNext.clipUrl !== url) source(part.upNext.clipUrl, v);
    if (surface.dataset.cover === 'closing' && now >= darkAt) cover('dark');
    if (v.error || v.dataset.failed) {
      cover(visible ? 'dark' : 'clear');
      if (fresh && !v.dataset.failed) {
        const retryAt = Number(v.dataset.retryAt);
        if (!retryAt) v.dataset.retryAt = String(now + 2000);
        else if (now >= retryAt) {
          v.dataset.retryAt = String(now + 4000);
          v.load();
        }
        return {message:'Waiting for the next Genie scene…'};
      }
      return {message:'This clip could not play. Waiting for the next scene.'};
    }
    if (v.readyState < 2) return {message: now - part.clipStartedAt > 2000 ? 'Loading the selected scene…' : ''};
    if (now < part.clipStartedAt || (visible === v && surface.dataset.cover === 'closing')) return {};
    const target = preparedTime(Math.max(now,darkAt), part.clipStartedAt, part.clipDurationMs, v.duration);
    const switching = visible !== v || surface.dataset.cover !== 'open';
    const tolerance = switching ? .35 : .9;
    if (!v.seeking && Math.abs(v.currentTime - target) > tolerance && now - lastSeek >= 700) {
      lastSeek = now;
      v.currentTime = target;
    }
    if (switching && (now < darkAt || v.seeking)) return {};
    if (switching) {
      if (visible && visible !== v) { visible.pause(); visible.hidden = true; }
      visible = v;
      v.hidden = false;
      cover('open');
    }
    if (v.paused && !v.ended && !v.dataset.starting) {
      v.dataset.starting = '1';
      const selectedUrl = v.getAttribute('src');
      v.play().catch(error => {
        if (error.name !== 'AbortError' && v.getAttribute('src') === selectedUrl) v.dataset.failed = '1';
      }).finally(() => { delete v.dataset.starting; });
    }
    return {playing:true};
  }
  return {show, suspend() { for (const v of slots) v.pause(); }};
}

export function preparedCue(part, display, now) {
  if (display.message) return {text:display.message};
  if (display.collecting) return {text:'Send a haunting from your phone.'};
  if (display.handoff) {
    if (display.fresh) return part.upNext?.title
      ? {label:'Preparing the next scene', text:part.upNext.title} : {text:'Preparing the next scene…'};
    return {label:'Up next', text:part.upNext?.title || 'The hallway is changing…'};
  }
  if (!display.playing) return {};
  if (typeof part.cue === 'string' && part.cue) return {text:part.cue};
  if (part.cue?.text) return {label:part.cue.label, text:part.cue.text, by:part.cue.by};
  return now - part.clipStartedAt < 3500 ? {label:'Now playing', text:part.sourceTitle} : {};
}
