import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLive } from './live.mjs';
import {
  newRound,
  beginPlay,
  applyDecision,
  observe,
  place,
  finish,
  openingMs,
  playMs,
} from './game.mjs';

export async function registerStage(
  app,
  {
    bus,
    root,
    newId,
    defaultPhoto,
    captureDir,
    makePilot,
    brainUrl = 'http://127.0.0.1:8903/api/brain/tick',
  },
) {
  let round = null,
    tickPending = false,
    number = 0,
    nextStep = 0;
  const basePhoto = readFileSync(
    defaultPhoto || resolve(root, '../painted-door/haunting/aisle.jpg'),
  );
  let photo = basePhoto,
    custom = false,
    revision = 0;
  const aliases = new Map(),
    queue = new Map(),
    frames = new Map(),
    ghosts = new Map();
  const first = [
    'Amber',
    'Velvet',
    'Misty',
    'Moss',
    'Copper',
    'Moon',
    'Ember',
    'Silver',
    'Dusk',
    'Quiet',
    'Little',
    'Indigo',
  ];
  const last = [
    'Wisp',
    'Moth',
    'Wraith',
    'Owl',
    'Sprite',
    'Shade',
    'Echo',
    'Specter',
    'Phantom',
    'Finch',
    'Raven',
    'Comet',
  ];
  function alias(req, reply) {
    const match = /(?:^|;\s*)pg_ghost=([\da-f-]{36})(?:;|$)/.exec(
      req.headers.cookie || '',
    );
    if (match && aliases.has(match[1])) return aliases.get(match[1]);
    const id = randomUUID(),
      i = aliases.size,
      cycle = Math.floor(i / (first.length * last.length));
    const name =
      first[i % first.length] +
      ' ' +
      last[(Math.floor(i / first.length) + i) % last.length] +
      (cycle ? ' ' + (cycle + 1) : '');
    aliases.set(id, name);
    reply.header(
      'set-cookie',
      'pg_ghost=' +
        id +
        '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000',
    );
    return name;
  }
  app.addHook('onRequest', async (req, reply) => {
    if (
      req.method === 'POST' &&
      req.headers.origin &&
      req.headers.origin !== 'http://' + req.headers.host
    )
      return reply.code(403).send({ error: 'Origin mismatch' });
  });
  app.addHook('preValidation', async (req, reply) => {
    if (
      req.url === '/api/crowd/haunt' &&
      req.method === 'POST' &&
      req.body &&
      typeof req.body === 'object'
    )
      req.body.displayName = alias(req, reply);
  });
  // Use our phone presentation for this rehearsal. All proposals still go through Crowd's real moderation.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.split('?')[0] === '/haunt') return reply.redirect('/phone');
  });
  let publicStatus = '',
    live = null,
    liveFrame = null,
    seed = null,
    pilot = null,
    pendingWinner = null,
    lastPose = null;
  const viewers = new Set();
  const liveMs = Number(process.env.PG_REHEARSAL_LIVE_MS || 45000);
  function sendFrame(stream, bytes) {
    if (stream.destroyed || stream.writableLength > bytes.length * 2) return;
    stream.write(
      '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' +
        bytes.length +
        '\r\n\r\n',
    );
    stream.write(bytes);
    stream.write('\r\n');
  }
  app.get('/rehearsal/video', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store',
    });
    viewers.add(res);
    if (liveFrame) sendFrame(res, liveFrame);
    res.once('close', () => viewers.delete(res));
  });
  const unsubscribe = bus.subscribe('*', (e) => {
    const h = e.payload;
    if (e.type === 'haunt.public' && h.moderated?.safe) {
      if (h.status === 'queued') {
        queue.set(h.hauntId, {
          id: h.hauntId,
          text: h.moderated.text,
          by: h.displayName,
        });
        ghosts.set(h.hauntId, h.displayName);
      } else queue.delete(h.hauntId);
    }
    if (
      e.type !== 'haunt.dispatch' ||
      round?.phase !== 'playing' ||
      h.episodeId !== round.id
    )
      return;
    if (round.live) {
      const prop = {
        id: h.hauntId,
        name: h.text,
        by: ghosts.get(h.hauntId),
        sentAt: Date.now(),
        acked: false,
        seen: false,
      };
      round.props.push(prop);
      live?.send({ haunt: { id: h.hauntId, text: h.text } });
      return;
    }
    const ok = place(round, h, Date.now());
    if (ok) round.props.at(-1).by = ghosts.get(h.hauntId);
    else publicStatus = 'That idea could not be staged in this rehearsal.';
    bus.publish(
      'haunt.injected',
      'world',
      {
        hauntId: h.hauntId,
        episodeId: round.id,
        t: Date.now() - round.startedAt,
        ok,
        simulated: true,
        ...(!ok ? { error: 'Unsupported rehearsal effect' } : {}),
      },
      round.id,
    );
  });
  function notifyEnd(r) {
    bus.publish(
      'episode.ended',
      'world',
      {
        episodeId: r.id,
        endedAt: r.finishedAt,
        durationMs: r.finishedAt - r.startedAt,
        reason:
          { time: 'timeout', exit: 'success_claim', fear: 'operator_stop' }[
            r.reason
          ] || 'error',
        genieClosedCleanly: r.live ? r.terminal === 'completed' : null,
        artifacts: { eventsPath: 'rehearsal', framesDir: 'fixtures' },
      },
      r.id,
    );
  }
  async function update() {
    const r = round,
      now = Date.now();
    if (!r || r.phase === 'ended') return;
    if (r.live) {
      if (r.phase === 'opening' && now >= r.deadline) {
        r.phase = 'preparing';
        try {
          live = openLive({
            dir: captureDir,
            seed,
            onMessage: (m) => {
              if (m.frame) {
                liveFrame = Buffer.from(m.frame, 'base64');
                for (const stream of viewers) sendFrame(stream, liveFrame);
                if (r.phase === 'preparing') {
                  r.phase = 'playing';
                  r.startedAt = Date.now();
                  r.deadline = r.providerDeadline || r.startedAt + liveMs;
                  publishStart(r, r.startedAt, liveMs);
                }
              }
              if (m.expiresAt) {
                r.providerDeadline = m.expiresAt;
                if (r.phase === 'playing') r.deadline = m.expiresAt;
              }
              if (m.injected && r.phase === 'playing') {
                const p = r.props.find((p) => p.id === m.injected);
                if (p && !p.acked) {
                  p.acked = true;
                  bus.publish(
                    'haunt.injected',
                    'world',
                    {
                      hauntId: p.id,
                      episodeId: r.id,
                      t: Date.now() - r.startedAt,
                      ok: true,
                      simulated: false,
                    },
                    r.id,
                  );
                }
              }
              if (
                m.scene &&
                r.phase === 'playing' &&
                Date.now() < r.deadline &&
                !pendingWinner
              ) {
                const decision = pilot(m.scene);
                r.seq++;
                r.action = decision.rationale;
                r.observed = m.observed;
                const prop = r.props.findLast(
                  (p) =>
                    p.acked && !p.reactedAt && Date.now() - p.sentAt < 12000,
                );
                const labels = m.scene.obstacles.map((o) =>
                  o.label.toLowerCase(),
                );
                if (prop) {
                  const words =
                    prop.name
                      .toLowerCase()
                      .match(/chair|peel|bucket|balloon|marble|paper|fog/g) ||
                    [];
                  if (
                    words.some((w) => labels.some((label) => label.includes(w)))
                  )
                    prop.seen = true;
                  if (
                    prop.seen &&
                    lastPose === 'upright' &&
                    m.scene.pose === 'stumbling'
                  ) {
                    prop.reactedAt = Date.now();
                    r.fear++;
                    r.lastReaction = {
                      at: prop.reactedAt,
                      name: prop.name,
                      flinch: true,
                    };
                  }
                }
                lastPose = m.scene.visible ? m.scene.pose : null;
                if (decision.successClaim || r.fear >= 3) {
                  pendingWinner = decision.successClaim ? 'robot' : 'audience';
                  live.send({ winner: pendingWinner });
                } else if (decision.action.key !== 'NOOP')
                  live.send({
                    key: decision.action.key,
                    ms: decision.action.holdMs,
                  });
              }
              if (m.observationFailed)
                r.action = 'Waiting for a clear observation';
              if (m.winner) pendingWinner = m.winner;
            },
            onClose: (terminal) => {
              live = null;
              r.terminal = terminal;
              const winner = terminal === 'completed' ? pendingWinner : null;
              const wasPlaying = !!r.startedAt;
              Object.assign(r, {
                phase: 'ended',
                finishedAt: Date.now(),
                winner,
                reason:
                  winner === 'robot'
                    ? 'exit'
                    : winner === 'audience'
                      ? r.fear >= 3
                        ? 'fear'
                        : 'time'
                      : 'interrupted',
              });
              if (wasPlaying) notifyEnd(r);
            },
          });
        } catch {
          r.phase = 'ended';
          r.reason = 'interrupted';
          publicStatus = 'The Genie session could not open.';
        }
      }
      return;
    }
    if (beginPlay(r, now)) publishStart(r, now, playMs);
    if (r.phase !== 'playing') return;
    await updateRehearsal(r, now);
  }
  function publishStart(r, now, duration) {
    bus.publish(
      'episode.started',
      'world',
      {
        episodeId: r.id,
        sessionId: null,
        mode: r.live ? 'genie' : 'replay',
        driver: 'brain',
        round: number,
        seed: { kind: 'image', imagePath: 'venue-photo' },
        policyVersion: 'v1',
        task: {
          targetLabel: 'exit',
          instruction: 'Reach the exit through the hallway.',
        },
        startedAt: now,
        maxDurationMs: duration,
      },
      r.id,
    );
  }
  async function updateRehearsal(r, now) {
    if (now >= r.deadline) {
      finish(r, 'audience', 'time', now);
      notifyEnd(r);
      return;
    }
    if (tickPending || now < nextStep) return;
    tickPending = true;
    nextStep = now + 600;
    try {
      const observation = observe(r);
      if (!frames.has(observation.frame))
        frames.set(
          observation.frame,
          readFileSync(
            resolve(
              root,
              '../painted-door/haunting/fixtures',
              observation.frame + '.jpg',
            ),
          ).toString('base64'),
        );
      const response = await fetch(brainUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4500),
        body: JSON.stringify({
          episodeId: r.id,
          seq: r.seq++,
          t: now - r.startedAt,
          driver: 'brain',
          frame: {
            width: 640,
            height: 360,
            mime: 'image/jpeg',
            b64: frames.get(observation.frame),
          },
          recentHaunts: [],
          frameDiff: 0.1,
        }),
      });
      if (!response.ok) throw Error('Player unavailable');
      const decision = await response.json();
      if (round !== r || r.phase !== 'playing') return;
      applyDecision(r, observation, decision, Date.now());
      if (r.phase === 'ended') notifyEnd(r);
    } catch {
      if (r.phase === 'playing') {
        finish(r, null, 'interrupted', Date.now());
        notifyEnd(r);
      }
    } finally {
      tickPending = false;
    }
  }
  const timer = setInterval(() => void update(), 150);
  app.addHook('onClose', async () => {
    clearInterval(timer);
    unsubscribe();
    live?.stop();
    for (const stream of viewers) stream.end();
  });
  app.get('/rehearsal/state', async () => ({
    round,
    number,
    queue: [...queue.values()],
    canLive: !!captureDir,
    custom,
    revision,
    publicStatus,
    now: Date.now(),
  }));
  app.get('/rehearsal/ghost', async (req, reply) => ({
    name: alias(req, reply),
  }));
  app.post('/rehearsal/start', async (req, reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round && round.phase !== 'ended')
      return reply.code(409).send({ error: 'A round is already open.' });
    const paid = req.body?.mode === 'genie';
    if (paid) {
      seed = Buffer.from(req.body?.seed || '', 'base64');
      if (
        !captureDir ||
        !makePilot ||
        seed.length < 100 ||
        seed.length > 48000 ||
        seed.readUInt16BE(0) !== 0xffd8
      )
        return reply
          .code(400)
          .send({ error: 'The live hallway needs a valid camera seed.' });
    }
    number++;
    liveFrame = null;
    pendingWinner = null;
    lastPose = null;
    publicStatus = '';
    round = newRound(newId('ep'), Date.now());
    round.live = paid;
    pilot = paid ? makePilot() : null;
    return { id: round.id, openingMs };
  });
  app.addContentTypeParser(
    'image/jpeg',
    { parseAs: 'buffer', bodyLimit: 512000 },
    (_req, body, done) => done(null, body),
  );
  app.post('/rehearsal/photo', async (req, reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round && round.phase !== 'ended')
      return reply.code(409).send({ error: 'Change photos between rounds.' });
    const b = req.body;
    if (
      !Buffer.isBuffer(b) ||
      b.length < 64 ||
      b.readUInt16BE(0) !== 0xffd8 ||
      b.readUInt16BE(b.length - 2) !== 0xffd9
    )
      return reply.code(400).send({ error: 'Choose a readable photo.' });
    photo = b;
    custom = true;
    revision++;
    round = null;
    return { revision };
  });
  app.post('/rehearsal/reset-photo', async (req, reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round && round.phase !== 'ended')
      return reply.code(409).send({ error: 'Change photos between rounds.' });
    photo = basePhoto;
    custom = false;
    revision++;
    round = null;
    return { revision };
  });
  app.get('/rehearsal/source', async (_, reply) =>
    reply.header('cache-control', 'no-store').type('image/jpeg').send(photo),
  );
  for (const [route, file, mime] of [
    ['/team', 'stage.html', 'text/html'],
    ['/stage', 'stage.html', 'text/html'],
    ['/phone', 'phone.html', 'text/html'],
    ['/stage.css', 'stage.css', 'text/css'],
    ['/stage.js', 'stage.js', 'text/javascript'],
    ['/scene.js', 'scene.js', 'text/javascript'],
    ['/photo.js', 'photo.mjs', 'text/javascript'],
    ['/phone.js', 'phone.js', 'text/javascript'],
    ['/hall.webp', 'long-hall.webp', 'image/webp'],
    ['/explorer.webp', 'explorer.webp', 'image/webp'],
    ['/peel.webp', '../painted-door/haunting/peel.webp', 'image/webp'],
  ])
    app.get(route, async (_, reply) =>
      reply.type(mime).send(readFileSync(resolve(root, file))),
    );
}
