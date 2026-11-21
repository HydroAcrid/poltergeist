import { createScene } from './scene.js';
import { readPhoto, toJpeg } from './photo.js';
const el = (id) => document.getElementById(id);
const host = location.pathname === '/team';
const canvas = el('scene'),
  liveImage = el('live');
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
let event,
  observed = new Set(),
  previousRound = '',
  lastQueue = '',
  previousCaption = '';
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
  if (!res.ok) throw Error((await res.json()).error || 'The request failed.');
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
    !!custom && (!ready || plateKey !== state.plateKey);
  el('default').hidden = !custom;
  if (host && lastBusy !== busy) {
    el('host').open = !busy;
    lastBusy = busy;
  }
}
function note(key, by, text, at) {
  if (observed.has(key)) return;
  observed.add(key);
  event = { by: by || 'Haunting', text, until: at + 3200 };
}
function events(r, at) {
  if (r?.id !== previousRound) {
    previousRound = r?.id;
    observed = new Set();
    event = null;
  }
  if (r?.phase !== 'playing') return;
  const effect = r.props.at(-1);
  if (effect && (effect.seen || !r.live))
    note(effect.id + ':visible', effect.by, effect.name, at);
  if (r.lastReaction) {
    const reaction = r.lastReaction;
    note(
      'react:' + reaction.at,
      effect?.by,
      reaction.flinch ? 'The robot flinched.' : 'The robot stepped aside.',
      at,
    );
  }
}
async function sync() {
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
  events(s.round, s.now);
  const r = s.round;
  if (r?.live && r.phase === 'playing' && liveId !== r.id) {
    liveId = r.id;
    liveImage.src = '/rehearsal/video?round=' + encodeURIComponent(r.id);
  } else if (liveId && r?.id !== liveId) {
    liveImage.removeAttribute('src');
    liveId = '';
  }
  if (s.plateError) set('message', s.plateError);
  el('host').hidden = !host;
  controls();
}
async function refresh() {
  try {
    await sync();
  } catch {
    connected = false;
    set('phase', 'Reconnecting');
    controls();
  } finally {
    setTimeout(refresh, 350);
  }
}
function paint() {
  const now = Date.now() + off,
    r = state?.round;
  if (state) {
    let phase = 'Before the round',
      label = 'Starts in',
      clock = '0:30',
      cue = '',
      caption = '';
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
        phase = r.live ? 'Live · Genie 4' : 'Round in play';
        clock = time(sec);
        label = 'Time left';
        if (r.live && !liveImage.naturalWidth) {
          caption = 'Connecting to the hallway…';
        } else if (event && event.until > now) {
          cue = event.by;
          caption = event.text;
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
      cue = '';
      caption = 'Reconnecting…';
    }
    set('phase', phase);
    set('timer-label', label);
    set('clock', clock);
    set('cue', cue);
    set('caption', caption);
    el('story').hidden = !caption;
    if (caption !== previousCaption) {
      set('announce', caption ? cue + ' ' + caption : '');
      previousCaption = caption;
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
    if (r?.live && r.phase === 'playing') {
      if (liveId === r.id && liveImage.naturalWidth)
        scene.drawLive(liveImage, r, now);
    } else if (!(r?.live && r.phase === 'ended' && liveId === r.id)) {
      scene.paint(state, now);
    }
  }
  requestAnimationFrame(paint);
}
async function run(fn) {
  if (loading) return;
  loading = true;
  controls();
  set('message', '');
  try {
    await fn();
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
window.addEventListener('pagehide', release);
refresh();
requestAnimationFrame(paint);
