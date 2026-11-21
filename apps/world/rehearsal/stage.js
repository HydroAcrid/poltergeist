import { createScene } from './scene.js';
import { readPhoto, toJpeg } from './photo.js';
const el = (id) => document.getElementById(id),
  host = location.pathname === '/team';
const canvas = el('scene'),
  liveImage = el('live');
let state,
  rev = -1,
  off = 0,
  stream,
  photo,
  loading = false,
  prior = '',
  connected = false,
  liveId = '';
const scene = await createScene(canvas);
const timestr = (s) =>
  Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
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
function list(s) {
  const [next, ...queue] = s.queue;
  el('count').textContent = s.queue.length;
  el('next').replaceChildren();
  const item = (parent, q) => {
    parent.textContent = q.text;
    if (q.by) {
      const by = document.createElement('span');
      by.className = 'by';
      by.textContent = q.by;
      parent.append(by);
    }
  };
  if (next) item(el('next'), next);
  else el('next').textContent = 'Waiting for an idea.';
  const items = queue.slice(0, 4).map((q) => {
    const li = document.createElement('li');
    item(li, q);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No other ideas queued.';
    items.push(li);
  }
  if (queue.length > 4) {
    const li = document.createElement('li');
    li.textContent = '+' + (queue.length - 4) + ' more';
    items.push(li);
  }
  el('queue').replaceChildren(...items);
}
function controls() {
  const busy = state?.round && state.round.phase !== 'ended';
  for (const id of ['start', 'go-live', 'capture', 'upload', 'default'])
    el(id).disabled = loading || busy || !connected;
  el('go-live').hidden = !state?.canLive;
  el('default').hidden = !state?.custom;
}
async function refresh() {
  try {
    const res = await fetch('/rehearsal/state', { cache: 'no-store' });
    if (!res.ok) throw Error();
    const s = await res.json();
    off = s.now - Date.now();
    if (rev !== s.revision) {
      await scene.setPhoto(s.revision);
      rev = s.revision;
    }
    state = s;
    connected = true;
    list(s);
    el('host').hidden = !host;
    controls();
    const r = s.round,
      visible =
        r?.live &&
        (r.phase === 'playing' || (r.phase === 'ended' && liveId === r.id));
    if (r?.live && r.phase === 'playing' && liveId !== r.id) {
      liveId = r.id;
      liveImage.src = '/rehearsal/video?round=' + encodeURIComponent(r.id);
    }
    liveImage.hidden = !visible;
    if (!visible && liveId && (!r || r.id !== liveId)) {
      liveImage.removeAttribute('src');
      liveId = '';
    }
  } catch {
    connected = false;
    el('phase').textContent = 'Reconnecting';
    controls();
  } finally {
    setTimeout(refresh, 350);
  }
}
function draw() {
  const now = Date.now() + off,
    s = state,
    r = s?.round;
  if (!s) {
    requestAnimationFrame(draw);
    return;
  }
  let phase = 'Before the round',
    cue = 'Venue photo',
    caption = 'This is where it starts.',
    title = 'The long hallway',
    clock = '0:30',
    label = 'Opening window';
  if (r) {
    const sec = Math.max(0, Math.ceil((r.deadline - now) / 1000)),
      elapsed = (now - r.openedAt) / 1000;
    if (r.phase === 'opening') {
      phase = 'Ghosts can submit';
      title = 'Haunt the hallway';
      clock = timestr(sec);
      label = 'Robot starts in';
      [cue, caption] =
        elapsed < 2
          ? ['Venue photo', 'The room you photographed.']
          : elapsed < 8
            ? ['The reveal', 'The hallway stretches into the dark.']
            : elapsed < 11
              ? ['Arrival', 'A flashlight cuts through the dark.']
              : [
                  'Ghosts gathering',
                  'Send a haunting before the robot sets off.',
                ];
    } else if (r.phase === 'preparing') {
      phase = 'Connecting to Genie 4';
      label = 'World generation';
      clock = '···';
      cue = 'Opening';
      caption = 'Waiting for the first live camera frame.';
    } else if (r.phase === 'playing') {
      phase = r.live ? 'Live · Genie 4' : 'Hallway rehearsal';
      clock = timestr(sec);
      label = 'Time left';
      cue = 'Robot';
      caption = r.live
        ? r.action === 'waiting'
          ? 'Finding the route'
          : r.action
        : 'Walking toward the exit.';
      const prop = r.props.at(-1);
      if (prop && !r.live && now - prop.placedAt < 2400) {
        cue = prop.by || 'Haunting';
        caption = prop.name + ' in the hallway.';
      }
      if (r.lastReaction && now - r.lastReaction.at < 2800) {
        cue = 'Robot reaction';
        caption = r.lastReaction.flinch
          ? 'The robot flinched.'
          : 'The robot stepped aside.';
      }
      if (prop && r.live && now - prop.sentAt < 4500) {
        cue = prop.by || 'Haunting';
        caption = prop.seen ? prop.name : 'Sent · ' + prop.name;
      }
    } else {
      phase =
        r.reason === 'interrupted' ? 'Round interrupted' : 'Round complete';
      label = 'Round time';
      clock = timestr(
        r.startedAt
          ? Math.max(0, Math.round((r.finishedAt - r.startedAt) / 1000))
          : 0,
      );
      title =
        r.winner === 'robot'
          ? 'The robot escaped'
          : r.winner === 'audience'
            ? 'The ghosts win'
            : 'The hallway closed';
      cue = 'Result';
      caption =
        {
          exit: 'The robot reached the exit.',
          fear: 'Three scares stopped the robot.',
          time: 'Time ran out in the hallway.',
        }[r.reason] || 'The round ended before a winner was confirmed.';
    }
  }
  if (connected) el('phase').textContent = phase;
  el('title').textContent = title;
  el('clock').textContent = clock;
  el('timer-label').textContent = label;
  el('cue').textContent = cue;
  el('caption').textContent = caption;
  el('format').textContent = r?.live
    ? r.phase === 'playing'
      ? 'Genie 4 · live camera'
      : 'Genie 4 round'
    : 'Interactive rehearsal';
  const pct = Math.round((r?.depth || 0) * 100),
    fear = r?.fear || 0;
  document.querySelector('.route i').style.width = pct + '%';
  document.querySelector('.route').setAttribute('aria-valuenow', pct);
  document.querySelector('.meters>div:first-child').hidden = !!r?.live;
  el('bay').textContent =
    pct === 0
      ? 'Entrance'
      : pct < 34
        ? 'Front lounge'
        : pct < 67
          ? 'Gallery'
          : pct < 100
            ? 'Far passage'
            : 'Exit';
  document.querySelector('.fear').setAttribute('aria-valuenow', fear);
  document
    .querySelectorAll('.fear i')
    .forEach((i, n) => i.classList.toggle('on', n < fear));
  el('fear').textContent = fear + ' / 3';
  if (prior !== caption) {
    el('announce').textContent = caption;
    prior = caption;
  }
  if (liveImage.hidden) scene.paint(s, now);
  requestAnimationFrame(draw);
}
async function run(fn) {
  if (loading) return;
  loading = true;
  controls();
  el('message').textContent = '';
  try {
    await fn();
  } catch (e) {
    el('message').textContent = e.message || 'Could not start.';
  } finally {
    loading = false;
    controls();
  }
}
el('start').onclick = () =>
  run(() => request('/rehearsal/start', { mode: 'offline' }));
el('go-live').onclick = () =>
  run(() =>
    request('/rehearsal/start', { mode: 'genie', seed: scene.seed(state) }),
  );
async function upload(blob) {
  const result = await request('/rehearsal/photo', blob, true);
  await scene.setPhoto(result.revision);
  el('message').textContent = 'Photo ready.';
}
for (const id of ['file', 'camera-file'])
  el(id).onchange = () =>
    run(async () => {
      const f = el(id).files[0];
      if (f) await upload(await readPhoto(f));
      el(id).value = '';
    });
el('upload').onclick = () => el('file').click();
el('default').onclick = () => run(() => request('/rehearsal/reset-photo'));
const dialog = el('camera'),
  video = dialog.querySelector('video');
function release() {
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  stream = null;
}
dialog.onclose = release;
el('capture').onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    el('camera-file').click();
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
    video.srcObject = stream;
    dialog.showModal();
    await video.play();
  } catch {
    release();
    if (dialog.open) dialog.close();
    el('message').textContent =
      'Camera unavailable. Choose a photo to continue.';
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
requestAnimationFrame(draw);
