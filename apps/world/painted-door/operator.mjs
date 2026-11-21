import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PG_OPERATOR_PORT || 8896);
const host = '127.0.0.1:' + port;
const seedPath = existsSync('runs/ghost-walk/aisle.jpg') ? 'runs/ghost-walk/aisle.jpg' : '../robot-v1/hallway-seed.jpg';
const roundSeed = readFileSync('../robot-v1/hallway-seed.jpg');
const roundPage = readFileSync('round.html');
let mode = 'manual', winner = null, lastMove = '', activity = '';
const seed = readFileSync(seedPath);
const page = readFileSync('operator.html');
const previewFiles = new Map([
  ['/haunting/', ['haunting/index.html', 'text/html; charset=utf-8']],
  ['/haunting/haunt.js', ['haunting/haunt.js', 'text/javascript']],
  ['/haunting/robot.js', ['haunting/robot.js', 'text/javascript']],
  ['/haunting/aisle.jpg', ['haunting/aisle.jpg', 'image/jpeg']],
  ['/haunting/ghost.webp', ['haunting/ghost.webp', 'image/webp']],
  ['/haunting/peel.webp', ['haunting/peel.webp', 'image/webp']],
]);
const actions = new Set(['peel', 'key_w', 'key_a', 'key_s', 'key_d', 'arrow_left', 'arrow_right']);
let child, deadline, frame = seed, phase = 'ready', detail = '';
let lastHeartbeat = 0;
let expiresAt = 0;
let version = 0;

function end() {
  if (!child || phase === 'ending') return;
  const running = phase === 'live';
  phase = 'ending';
  if (running && child.connected) child.send('end');
  else child.kill('SIGTERM');
}

function start(isRound = false) {
  if (child) throw new Error('A round is already open.');
  mode = isRound ? 'round' : 'manual';
  winner = null;
  lastMove = '';
  activity = '';
  phase = 'starting';
  detail = '';
  frame = isRound ? roundSeed : seed;
  version++;
  lastHeartbeat = Date.now();
  expiresAt = isRound ? 0 : lastHeartbeat + 30_000;
  const worker = fork('capture.mjs', isRound ? ['--live','--round'] : ['--live', '--drive', '--photo', seedPath], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [],
  });
  child = worker;
  worker.stderr.resume();
  worker.on('message', message => {
    if (message.frame && phase !== 'ending') {
      frame = Buffer.from(message.frame, 'base64');
      version++;
      phase = 'live';
    }
    if (message.expiresAt) expiresAt = message.expiresAt;
    if (message.winner) winner = message.winner;
    if (message.move) lastMove = message.move;
    if (message.event === 'Audience requested a chair') activity = 'Chair requested';
    if (message.event === 'Audience requested a peel') activity = 'Banana peel requested';
    if (message.terminal) {
      detail = 'Genie session: ' + message.terminal;
      if (message.terminal !== 'completed') winner = null;
    }
  });
  worker.on('error', () => { detail = 'Could not launch the world session.'; });
  worker.on('close', () => {
    clearInterval(deadline);
    if (!detail) detail = 'The session closed before it could confirm completion. Check the local capture log.';
    phase = 'closed';
    child = undefined;
    expiresAt = 0;
  });
  if (!isRound) deadline = setInterval(() => {
    if (Date.now() >= expiresAt || Date.now() - lastHeartbeat > 6000) end();
  }, 500);
}

const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  const reply = (code, type, payload) => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(payload);
  };
  const json = (code, data) => reply(code, 'application/json', JSON.stringify(data));
  if (req.headers.host !== host) return json(403, { error: 'Local access only.' });
  const path = new URL(req.url, 'http://' + host).pathname;
  if (req.method === 'GET') {
    if (path === '/' || path === '/haunting') {
      res.writeHead(302, { Location: '/haunting/' });
      return res.end();
    }
    if (path === '/runs/ghost-walk/aisle.jpg') return reply(200, 'image/jpeg', seed);
    const asset = previewFiles.get(path);
    if (asset) return reply(200, asset[1], readFileSync(asset[0]));
    if (path === '/round' || path === '/audience') return reply(200,'text/html; charset=utf-8',roundPage);
    if (path === '/round-preview') return reply(200,'image/jpeg',roundSeed);
    if (path === '/operator') return reply(200, 'text/html; charset=utf-8', page);
    if (path === '/frame') return reply(200, 'image/jpeg', frame);
    if (path === '/status') return json(200, { phase, detail, version, expiresAt, mode, winner, lastMove, activity });
    return json(404, {});
  }
  if (req.method !== 'POST' || req.headers.origin !== 'http://' + host || req.headers['x-operator'] !== '1') {
    return json(403, {});
  }
  const action = path.slice(1);
  try {
    if (action === 'start-round') start(true);
    else if (action === 'start') start();
    else if (action === 'heartbeat') lastHeartbeat = Date.now();
    else if (action === 'end') end();
    else if (phase === 'live' && child?.connected &&
      (mode === 'round' ? ['chair','peel'].includes(action) : actions.has(action))) child.send(action);
    else return json(409, { error: 'This control needs an active round.' });
    return json(200, { phase });
  } catch (error) {
    return json(409, { error: error.message });
  }
});
server.listen(port, '127.0.0.1', () => console.log('World controls at http://' + host + '/operator'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    end();
    server.close();
    server.closeAllConnections();
  });
}
