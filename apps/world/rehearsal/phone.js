const el = (id) => document.getElementById(id);
const ghost = await (await fetch('/rehearsal/ghost')).json();
el('name').textContent = ghost.name;
let busy = false,
  latest = '',
  receipt = '',
  active = true;
function announce(text) {
  if (text && text !== receipt) {
    receipt = text;
    el('receipt').textContent = text;
  }
}
function setSendError(text) {
  el('send-error').textContent = text;
  el('send-error').hidden = !text;
}
async function send(body) {
  if (busy || !active) return;
  busy = true;
  setSendError('');
  try {
    const res = await fetch('/api/crowd/haunt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { setSendError(data.error?.message || 'Your idea could not be sent. Try again.'); return; }
    latest = data.hauntId;
    el('idea').value = '';
    announce(body.preset ? 'Your pick was received.' : 'Checking your idea…');
    await refresh();
  } catch {
    setSendError('No connection. Try again in a moment.');
  } finally {
    busy = false;
  }
}
const presets = await (await fetch('/api/crowd/presets')).json();
for (const id of [
  'chair-tips',
  'banana-peel',
  'fog',
  'paper-gust',
  'lights-flicker',
]) {
  const item = presets.find((p) => p.id === id);
  if (!item) continue;
  const b = document.createElement('button');
  b.textContent = item.label;
  b.onclick = () => send({ preset: id });
  el('presets').append(b);
}
document.querySelector('form').onsubmit = (e) => {
  e.preventDefault();
  const text = el('idea').value.trim();
  if (text) send({ text });
  else setSendError('Write an idea or choose a preset.');
};
const status = {
  submitted: 'Checking your idea',
  queued: 'In the queue',
  approved: 'In the queue',
  dispatched: 'Up next',
  injected: 'Sent to the hallway',
  failed: 'Didn’t appear this round',
  rejected: 'Edit your idea or choose another haunting',
};
async function refresh() {
  try {
    const [state, stage] = await Promise.all(
      ['/api/crowd/state', '/rehearsal/state'].map(async (u) =>
        (await fetch(u)).json(),
      ),
    );
    const r = stage.round;
    active = !r || ['opening', 'playing', 'preparing'].includes(r.phase);
    el('phase').textContent =
      r?.phase === 'opening'
        ? 'Ideas open · ' +
          Math.max(0, Math.ceil((r.deadline - stage.now) / 1000)) +
          's until play'
        : r?.phase === 'playing'
          ? 'Round in play'
          : r?.phase === 'ended'
            ? 'Round over'
            : r?.phase === 'preparing'
              ? 'The hallway is opening'
              : 'Waiting for the host';
    for (const b of document.querySelectorAll('form button,.chips button'))
      b.disabled = !active;
    const rows = state.mine.map((h) => {
      const prop = r?.props.find((p) => p.id === h.hauntId);
      let label = status[h.status] || 'Received';
      if (prop?.seen || (prop && !r.live)) label = 'In the hallway';
      if (prop?.reactedAt)
        label =
          prop.response === 'dodge'
            ? 'The robot stepped aside'
            : 'You startled the robot!';
      const row = document.createElement('div');
      row.className = 'mine-row';
      const title = document.createElement('span');
      title.textContent = h.moderated?.safe ? h.moderated.text : 'Your idea';
      const outcome = document.createElement('b');
      outcome.textContent = label;
      row.append(title, outcome);
      if (h.hauntId === (latest || state.mine[0]?.hauntId))
        announce(label + '.');
      return row;
    });
    el('mine').replaceChildren(...rows);
    if (!rows.length && !receipt)
      el('receipt').textContent = 'Your first haunting will appear here.';
  } catch {
    el('phase').textContent = 'Reconnecting…';
  }
}
await refresh();
setInterval(refresh, 700);
