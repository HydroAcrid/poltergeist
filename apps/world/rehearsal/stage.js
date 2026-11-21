import { hauntCue } from './haunt-cue.mjs';
import { createScene } from './scene.js';
import { readPhoto, toJpeg } from './photo.js';
const el = (id) => document.getElementById(id);
const debugPage = location.pathname === '/debug';
const host = debugPage || location.pathname === '/team';
const diagnostics = host ? await import('./host-debug.mjs') : null;
const canvas = el('scene'),
  liveImage = el('live');
const hud = document.querySelector('.hud');
function positionCue() {
  document.documentElement.style.setProperty('--cue-top', Math.ceil(hud.getBoundingClientRect().bottom + 12) + 'px');
}
new ResizeObserver(positionCue).observe(hud);
window.addEventListener('resize', positionCue);
positionCue();
const scene = await createScene(canvas);
let state,
  revision = -1,
  plateKey,
  off = 0,
  cameraStream,
  loading = false,
  connected = false,
  liveId = '',
  lastBusy;
let lastQueue = '',
  previousCaption = '';
let refreshTimer, syncing, refreshing = false, running = true, paintId = 0, paintedStill = '';
let testId, receipt, revisionOf, testError = '', submitting = false, nextReceiptAt = 0;
if (host) {
  try { testId = sessionStorage.getItem('pg_world_test_idea'); } catch {}
  el('obstacle-test').open = debugPage;
}
const set = (id, text) => {
  if (el(id).textContent !== text) el(id).textContent = text;
};
const time = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
async function request(url, body, photo = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': photo ? 'image/jpeg' : 'application/json',
      'x-show-control': '1',
    },
    body: photo ? body : JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const {error} = await res.json().catch(() => ({}));
    throw Error(error?.message || (typeof error === 'string' && error) || 'The request failed.');
  }
  return res.json();
}
function queue(s) {
  const current = JSON.stringify(s.queue);
  if (current === lastQueue) return;
  lastQueue = current;
  const [first, ...rest] = s.queue;
  set('count', String(s.queue.length));
  function row(node, idea) {
    node.textContent = idea.text;
    if (idea.by) {
      const by = document.createElement('span');
      by.className = 'by';
      by.textContent = idea.by;
      node.append(by);
    }
  }
  if (first) row(el('next'), first);
  else set('next', 'Waiting for an idea.');
  const rows = rest.slice(0, 4).map((idea) => {
    const li = document.createElement('li');
    row(li, idea);
    return li;
  });
  if (rest.length > 4) {
    const li = document.createElement('li');
    li.textContent = '+' + (rest.length - 4) + ' more';
    rows.push(li);
  }
  el('queue').replaceChildren(...rows);
}
function controls() {
  const busy = !!state?.round && state.round.phase !== 'ended';
  for (const id of [
    'start',
    'go-live',
    'capture',
    'upload',
    'default',
    'prepare',
  ])
    el(id).disabled = loading || busy || !connected;
  const custom = state?.custom,
    ready = state?.plateReady,
    preparing = state?.platePreparing;
  el('prepare').hidden = !custom || !state?.canLive || ready;
  el('prepare').disabled ||= !!preparing;
  set('prepare', preparing ? 'Preparing photo…' : 'Prepare photo for Genie');
  el('go-live').hidden = !state?.canLive;
  el('go-live').disabled ||=
    !!state?.providerClosing || (!!custom && (!ready || plateKey !== state.plateKey));
  set('go-live', state?.providerClosing ? 'Closing live hallway…' : 'Start Genie round');
  el('default').hidden = !custom;
  if (host) {
    set('host-readiness', diagnostics.readiness(state));
    el('test-send').disabled = submitting || !connected;
    el('test-observations').hidden = !state?.round;
    if (state?.round) {
      const view = diagnostics.observations(state.round, testId, state.now);
      for (const [key, value] of Object.entries(view)) set('test-' + key, value);
    }
  }
  if (host && lastBusy !== busy) {
    if (!debugPage || lastBusy === undefined) el('host').open = debugPage || !busy;
    lastBusy = busy;
  }
}
function renderReceipt() {
  set('test-status', testError || (testId ? diagnostics.privateReceipt(receipt) : ''));
  el('test-revise').hidden = receipt?.status !== 'rejected' || !receipt.moderated?.suggestion || !!revisionOf;
}
async function refreshReceipt() {
  if (!host || !testId || submitting || !el('obstacle-test').open || !el('host').open ||
      Date.now() < nextReceiptAt) return;
  nextReceiptAt = Date.now() + 1500;
  const id = testId;
  try {
    const res = await fetch('/api/crowd/state?waitingPage=0', {cache: 'no-store'});
    if (!res.ok) return;
    const data = await res.json();
    if (id !== testId || !running) return;
    const mine = data.mine.find(item => item.hauntId === id);
    if (mine) { receipt = mine; renderReceipt(); }
    else if (!receipt) set('test-status', 'No receipt for this idea on this host.');
  } catch {} // Retain the last known receipt on a temporary disconnection.
}
if (host) {
  el('test-form').onsubmit = async event => {
    event.preventDefault();
    const input = el('test-idea');
    const text = input.value.trim();
    if (!text || submitting) return;
    submitting = true;
    testError = '';
    controls();
    try {
      const result = await request('/api/crowd/haunt', {text, ...(revisionOf ? {revisionOf} : {})});
      testId = result.hauntId;
      try { sessionStorage.setItem('pg_world_test_idea', testId); } catch {}
      receipt = {status: result.status};
      revisionOf = undefined;
      nextReceiptAt = 0;
      input.value = '';
    } catch (error) {
      testError = error.message;
    } finally {
      submitting = false;
      controls();
      renderReceipt();
    }
  };
  el('test-revise').onclick = () => {
    if (!receipt?.moderated?.suggestion) return;
    revisionOf = testId;
    el('test-idea').value = receipt.moderated.suggestion;
    el('test-idea').focus();
    renderReceipt();
  };
}
function sync() {
  if (!syncing) syncing = updateState().finally(() => { syncing = undefined; });
  return syncing;
}
async function updateState() {
  const res = await fetch('/rehearsal/state', { cache: 'no-store' });
  if (!res.ok) throw Error();
  const s = await res.json();
  off = s.now - Date.now();
  if (revision !== s.revision) {
    await scene.setPhoto(s.revision);
    revision = s.revision;
  }
  if (plateKey !== s.plateKey) {
    await scene.setPlate(s.plateKey);
    plateKey = s.plateKey;
  }
  state = s;
  connected = true;
  queue(s);

  const r = s.round;
  canvas.classList.toggle('native-frame', !!r?.live);
  if (r?.live && r.phase === 'playing' && liveId !== r.id && running && !document.hidden) {
    liveId = r.id;
    liveImage.src = '/rehearsal/video?round=' + encodeURIComponent(r.id);
  } else if (liveId && (r?.id !== liveId || r.phase === 'ended')) {
    liveImage.removeAttribute('src');
    liveId = '';
  }
  if (s.plateError || s.publicStatus) set('message', s.plateError || s.publicStatus);
  el('host').hidden = !host;
  controls();
  schedulePaint();
  await refreshReceipt();
}
async function refresh() {
  if (refreshing || !running || document.hidden) return;
  refreshing = true;
  try {
    await sync();
  } catch {
    connected = false;
    set('phase', 'Reconnecting');
    controls();
    schedulePaint();
  } finally {
    refreshing = false;
    if (running && !document.hidden) {
      const busy = state?.round && state.round.phase !== 'ended';
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, busy ? 350 : 1500);
    }
  }
}
function schedulePaint() {
  if (!paintId && running && !document.hidden) paintId = requestAnimationFrame(paint);
}
function paint() {
  paintId = 0;
  const now = Date.now() + off,
    r = state?.round;
  if (state) {
    const active = r && r.phase !== 'ended';
    let worldVisible = false;
    if (active) {
      paintedStill = '';
      if (r.live) worldVisible = scene.presentLive(liveId === r.id ? liveImage : null, r, now);
      else scene.paint(state, now);
    } else {
      const still = [state.revision, r?.id || 'lobby'].join('/');
      if (paintedStill !== still) {
        // Keep the last native image visible through the result.
        if (!r?.live) scene.paint(state, now);
        else if (!r.startedAt || !canvas.dataset.played || canvas.dataset.played !== r.id)
          scene.paint({...state, round: null}, now);
        paintedStill = still;
      }
    }
    if (worldVisible && canvas.dataset.played !== r.id) canvas.dataset.played = r.id;
    let phase = 'Before the round',
      label = 'Starts in',
      clock = '0:30',
      cue = '',
      caption = '',
      by = '',
      card = null;
    if (r) {
      const sec = Math.max(0, Math.ceil((r.deadline - now) / 1000)),
        elapsed = (now - r.openedAt) / 1000;
      if (r.phase === 'opening') {
        phase = 'Ghosts can submit';
        clock = time(sec);
        if (elapsed >= 12 && elapsed < 16) {
          cue = '';
          caption = 'Ghosts, send a haunting.';
        }
      } else if (r.phase === 'preparing') {
        phase = 'Opening the hallway';
        clock = '···';
        label = 'Opening';
      } else if (r.phase === 'playing') {
        phase = r.live ? (worldVisible ? 'Live · Genie 4' : 'Opening the hallway') : 'Round in play';
        clock = time(sec);
        label = 'Time left';
        card = hauntCue(r, now);
        if (card) {
          cue = card.label;
          caption = card.text;
          by = [card.by, card.intent].filter(Boolean).join(' · ');
        } else if (r.live && !worldVisible && now-r.startedAt > 4500) {
          caption = 'Opening the hallway…';
        }
      } else {
        phase =
          r.reason === 'interrupted' ? 'Round interrupted' : 'Round complete';
        label = 'Round time';
        clock = time(
          r.startedAt
            ? Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000))
            : 0,
        );
        cue =
          r.winner === 'audience'
            ? 'Ghosts win'
            : r.winner === 'robot'
              ? 'Robot wins'
              : 'Round over';
        caption =
          {
            time: 'Time ran out.',
            fear: 'Three scares stopped the robot.',
            exit: 'The robot escaped.',
          }[r.reason] || 'The hallway closed.';
      }
    }
    if (!connected) {
      phase = 'Reconnecting';
      cue = '';
      caption = 'Reconnecting…';
      card = null;
      by = '';
    }
    set('phase', phase);
    set('timer-label', label);
    set('clock', clock);
    set('cue', cue);
    set('caption', caption);
    set('ghost-by', by);
    const story = el('story');
    story.classList.toggle('haunt-card', !!card);
    const robotX = r?.trackedBody ? (r.trackedBody[1] + r.trackedBody[3]) / 2 : r?.trackedFeet?.[1];
    story.classList.toggle('on-left', !!card && r?.trackedAt > now - 5000 && robotX > 520);
    el('story').hidden = !caption;
    const announcement = [cue, caption, by].filter(Boolean).join('. ');
    if (announcement !== previousCaption) {
      set('announce', announcement);
      previousCaption = announcement;
    }
    const fear = r?.fear || 0,
      fearMeter = document.querySelector('.fear');
    if (fearMeter.getAttribute('aria-valuenow') !== String(fear)) {
      fearMeter.setAttribute('aria-valuenow', fear);
      fearMeter.setAttribute('aria-valuetext', fear + ' of 3 scares');
      fearMeter
        .querySelectorAll('i')
        .forEach((i, n) => i.classList.toggle('on', n < fear));
      set('fear', fear + ' / 3');
    }
  }
  if (r && r.phase !== 'ended') schedulePaint();
}
async function run(fn) {
  if (loading) return;
  loading = true;
  controls();
  set('message', '');
  try {
    await fn();
    if (syncing) await syncing.catch(() => {});
    await sync();
  } catch (e) {
    set('message', e.message || 'Could not continue.');
  } finally {
    loading = false;
    controls();
  }
}
el('book').ontoggle = () => {
  if (el('book').open) el('host').open = false;
};
el('host').ontoggle = () => {
  if (el('host').open) el('book').open = false;
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || el('camera').open) return;
  for (const id of ['book', 'host'])
    if (el(id).open) {
      el(id).open = false;
      el(id).querySelector('summary').focus();
    }
});
el('start').onclick = () =>
  run(() => request('/rehearsal/start', { mode: 'offline' }));
el('go-live').onclick = () =>
  run(() =>
    request('/rehearsal/start', {
      mode: 'genie',
      plateKey: state.plateKey,
      seed: scene.seed(state),
    }),
  );
el('prepare').onclick = () =>
  run(() => request('/rehearsal/prepare-photo', { revision: state.revision }));
el('default').onclick = () => run(() => request('/rehearsal/reset-photo'));
async function upload(blob) {
  await request('/rehearsal/photo', blob, true);
  set('message', 'Photo selected.');
}
for (const id of ['file', 'camera-file'])
  el(id).onchange = () =>
    run(async () => {
      const f = el(id).files[0];
      if (f) await upload(await readPhoto(f));
      el(id).value = '';
    });
el('upload').onclick = () => el('file').click();
const dialog = el('camera'),
  video = dialog.querySelector('video');
function release() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  cameraStream = null;
}
dialog.onclose = release;
el('capture').onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    el('camera-file').click();
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    video.srcObject = cameraStream;
    dialog.showModal();
    await video.play();
  } catch {
    release();
    if (dialog.open) dialog.close();
    set('message', 'Camera unavailable. Choose a photo to continue.');
    el('camera-file').click();
  }
};
el('cancel').onclick = () => dialog.close();
el('shutter').onclick = () =>
  run(async () => {
    const blob = await toJpeg(video, video.videoWidth, video.videoHeight);
    dialog.close();
    await upload(blob);
  });
function suspend() {
  clearTimeout(refreshTimer);
  cancelAnimationFrame(paintId);
  paintId = 0;
  if (liveId) { liveImage.removeAttribute('src'); liveId = ''; }
  if (dialog.open) dialog.close();
  release();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
  else if (running) refresh();
});
window.addEventListener('pagehide', () => { running = false; suspend(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { running = true; refresh(); }
});
refresh();
