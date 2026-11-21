import {createPlayout, frameSink, jpegPart} from './video-stream.mjs';
import {createPreparedShow, registerPreparedMedia, serveMovie, preparedLibrary} from './prepared-show.mjs';
import {createBufferedShow} from './buffered-show.mjs';
import {renderSegment, bufferedEncoderReady} from './buffered-render.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPlateCache, photoKey } from './photo-plate.mjs';
import { openingCorrection, reviewedVenueOpening, reviewPlayerSeed } from './seed-review.mjs';
import { worldLeaseWarning } from '../../hosting/world-lease.mjs';
import { canCrossThreshold, observedCrossing } from './crossing.mjs';
import { checkpointEligible,validCheckpoint,matchDurationMs,fiveMinuteShowMs,chapterCutMs,chapterLimitMs } from './chapters.mjs';
import { openLive } from './live.mjs';
import { hauntCue } from './haunt-cue.mjs';
import { proposedKey } from './move-trace.mjs';
import { createPlacementController, freshObservation } from './placement.mjs';
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
    generatePlate,
    reviewSeed = reviewPlayerSeed,
    launchLive = openLive,
    renderBuffered = renderSegment,
    canEncode = bufferedEncoderReady,
    library = preparedLibrary,
    chapterTiming = {matchMs:matchDurationMs,cutMs:chapterCutMs,limitMs:chapterLimitMs},
    crowdPhone = false,
    hosted = false,
    internalBrainToken,
    brainUrl = 'http://127.0.0.1:8903/api/brain/tick',
  },
) {
  // A deployment gateway and its running sandbox can have separate Git revisions.
  let runtimeCommit;
  try {
    const sha = readFileSync(resolve(root, '../../../.release-commit'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(sha)) runtimeCommit = sha;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const preparedEncountersAvailable=library.effectOptions.length>0;
  registerPreparedMedia(app, root,library);
  let prepared = null, buffered = null;
  app.get('/rehearsal/segments/:round/:file', async (req,reply) => {
    const match = /^([1-9]\d*)\.mp4$/.exec(req.params.file);
    const path = round?.id === req.params.round && match && buffered?.file(Number(match[1]));
    if (!path) return reply.code(404).send();
    return serveMovie(path, req, reply);
  });
  let lobbyOpenedAt = null;
  let crossing = {};
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
  const stockPlate = readFileSync(resolve(root, 'long-hall.webp'));
  const plates = createPlateCache({
    captureDir,
    generate: generatePlate,
  });
  let sourceKey = 'venue';
  let checkingPlayer = false;
  const venueOpening = reviewedVenueOpening(root, stockPlate);
  const seedReviews = new Map();
  function plateStatus() {
    const entry = custom ? plates.get(sourceKey) : null;
    const ready = !custom || !!entry?.image;
    return {
      plateReady: ready,
      platePreparing: !!entry?.pending,
      plateError: entry?.error || null,
      plateKey: ready ? sourceKey : null,
      aisle: custom ? entry?.image?.aisle || null : {x:.585,y:.48},
    };
  }
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
  app.get('/', async (_req, reply) => reply.redirect('/haunt'));
  app.addHook('onRequest', async (req, reply) => {
    if (hosted && captureDir && req.method === 'POST' && req.routeOptions.url === '/api/crowd/haunt' &&
        round?.phase === 'ended')
      return reply.code(409).send({ error: { code: 'BUSY', message: 'This round has ended. The host can open the next lobby.' } });
  });
  app.addHook('preValidation', async (req, reply) => {
    if (
      !crowdPhone &&
      req.url === '/api/crowd/haunt' &&
      req.method === 'POST' &&
      req.body &&
      typeof req.body === 'object'
    )
      req.body.displayName = alias(req, reply);
  });
  // Use our phone presentation for this rehearsal. All proposals still go through Crowd's real moderation.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!crowdPhone && path === '/haunt') return reply.redirect('/phone');
    if (crowdPhone && path === '/phone') return reply.redirect('/haunt');
  });
  let publicStatus = '',
    live = null,
    liveFrame = null,
    seed = null,
    pilot = null,
    pendingWinner = null,
    providerRound = null,
    placement = null;
  const publishedStarts = new WeakSet();
  let activeTicket=null, continuation=null, nextChapterReady=false, chapterStartedAt=0, closing=false;
  const viewers = new Map();
  const liveMs = Number(process.env.PG_REHEARSAL_LIVE_MS || 45000);
  let videoChapter='', videoSequence=0;
  const playout=createPlayout(packet=>{
    liveFrame=packet;
    for (const viewer of viewers.values()) viewer.sink.offer(packet);
  });
  function nextVideoChapter(r) {
    const key=r.id+'/'+(r.chapter || 1);
    if (key===videoChapter) return;
    videoChapter=key;videoSequence=0;liveFrame=null;playout.reset();
    for (const [stream,viewer] of viewers) if (viewer.scope &&
        (viewer.scope.id!==r.id || viewer.scope.chapter!==(r.chapter || 1))) {
      viewer.sink.close();stream.end();viewers.delete(stream);
    }
  }
  app.get('/rehearsal/video', async (req, reply) => {
    const hasChapter=req.query?.chapter!=null;
    const scoped=req.query?.round!=null || hasChapter;
    if ((scoped && req.query?.round!==round?.id) ||
        (round?.chapters && (!hasChapter || round.phase==='ended')) ||
        (hasChapter && Number(req.query.chapter)!==(round?.chapter || 1)))
      return reply.code(409).send({error:'That hallway view has closed.'});
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const sink=frameSink((packet,done)=>res.write(packet,done));
    viewers.set(res,{sink,scope:scoped ? {id:round.id,chapter:round.chapter || 1} : null});
    if (liveFrame) sink.offer(liveFrame);
    res.once('close', () => {sink.close();viewers.delete(res);});
  });
  const unsubscribe = bus.subscribe('*', (e) => {
    const h = e.payload;
    if (e.type === 'haunt.public') {
      if (h.status === 'queued' && h.moderated?.safe) {
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
      (round?.phase !== 'playing' && !(round?.playMode === 'buffered-live' && round.phase === 'preparing') && !(round?.chapters && round.phase==='handoff')) ||
      h.episodeId !== round.id
    )
      return;
    if (round.playMode === 'buffered-live') {
      if (!buffered.enqueue(h,ghosts.get(h.hauntId),Date.now()))
        bus.publish('haunt.injected','world',{hauntId:h.hauntId,episodeId:round.id,t:round.startedAt ? Date.now()-round.startedAt : 0,
          ok:false,simulated:false,error:'The render queue has closed.'},round.id);
      return;
    }
    if (round.playMode === 'prepared-show') {
      if (!prepared.choose(h, ghosts.get(h.hauntId), Date.now())) {
        bus.publish('haunt.injected','world',{hauntId:h.hauntId,episodeId:round.id,
          t:Date.now()-round.startedAt,ok:false,simulated:true,error:'That recording could not be scheduled.'},round.id);
      }
      return;
    }
    if (round.live) {
      placement?.add(h.hauntId, h.text, ghosts.get(h.hauntId));
      return;
    }
    const upcoming = round.upcoming ||= [];
    if (!upcoming.some((p) => p.id === h.hauntId) && !round.props.some((p) => p.id === h.hauntId)) {
      upcoming.push({ id: h.hauntId, name: h.text, by: ghosts.get(h.hauntId), selectedAt: Date.now(), cueAt: null });
    }
  });
  function placeOffline(r, item, now) {
    const ok = place(r, {hauntId: item.id, text: item.name}, now);
    if (ok) Object.assign(r.props.at(-1), { by: item.by, selectedAt: item.selectedAt, sentAt: now, seenAt: now, seen: true, inPath: true });
    else publicStatus = 'That idea could not be staged in this rehearsal.';
    bus.publish(
      'haunt.injected',
      'world',
      {
        hauntId: item.id,
        episodeId: r.id,
        t: now - r.startedAt,
        ok,
        simulated: true,
        ...(!ok ? { error: 'Unsupported rehearsal effect' } : {}),
      },
      r.id,
    );
  }
  function notifyEnd(r) {
    if (!publishedStarts.has(r)) return;
    bus.publish(
      'episode.ended',
      'world',
      {
        episodeId: r.id,
        endedAt: r.finishedAt,
        hallway: {
          reason: r.reason,
          // The shared scoreboard counts scares and sidesteps. A defensive hold is
          // visible in World but earns neither of those scores.
          reactions: r.props.filter(p => ['scare','sidestep'].includes(p.observedReaction) && p.reactedAt).map(p => ({
            hauntId: p.id, at: p.reactedAt, kind: p.observedReaction,
          })),
        },
        durationMs: r.chapters && r.clockMode!=='wall' ? r.durationMs-r.remainingMs : r.startedAt == null ? 0 : r.finishedAt-r.startedAt,
        reason:
          { time: 'timeout', exit: 'success_claim', fear: 'operator_stop' }[
            r.reason
          ] || 'error',
        genieClosedCleanly: r.live && r.terminal ? r.terminal === 'completed' : null,
        artifacts: { eventsPath: 'rehearsal', framesDir: 'fixtures' },
      },
      r.id,
    );
  }
  function endLiveGame(r, winner) {
    if (r.phase !== 'playing' && !(r.chapters && r.startedAt && r.phase==='handoff')) return;
    const reason = winner === 'robot' ? 'exit'
      : winner === 'audience' ? (r.fear >= 3 ? 'fear' : 'time') : 'interrupted';
    const now = Date.now();
    const endedAt = r.clockMode==='wall' ? Math.min(r.showDeadline,now)
      : reason==='time' ? Math.max(r.startedAt,Math.min(r.deadline,now)) : now;
    if (r.chapters && (r.phase==='playing' || r.clockMode==='wall')) r.remainingMs=reason==='time' ? 0 : Math.max(0,r.deadline-now);
    if (r.phase==='handoff') Object.assign(r,{phase:'ended',winner,reason,finishedAt:endedAt,action:'stopped'});
    else finish(r, winner, reason, endedAt);
    placement?.finish();
    if (r.chapters) {
      liveFrame=null;
      playout.reset();
      for (const [stream,viewer] of viewers) if (!viewer.scope || viewer.scope.id===r.id) {
        viewer.sink.close();stream.end();
        viewers.delete(stream);
      }
    }
    notifyEnd(r);
  }
  function providerClosing() {
    return (providerRound?.phase === 'ended' && providerRound.providerClosedAt == null) ||
      (round?.phase === 'ended' && buffered?.busy);
  }
  function interrupt(r,message) {
    publicStatus=message;
    r.stopDetail=message;
    nextChapterReady=false;
    continuation=null;
    if (r.startedAt) endLiveGame(r,null);
    else Object.assign(r,{phase:'ended',reason:'interrupted',finishedAt:Date.now(),action:'stopped'});
    live?.stop();
  }
  function failLiveCallback(r) {
    if (r !== round || !r.live || r.callbackFailed) return;
    r.callbackFailed = true;
    nextChapterReady = false;
    continuation = null;
    r.stopDetail = publicStatus = publishedStarts.has(r)
      ? 'World could not finish updating the round. The hallway is closing.'
      : 'The round start could not be delivered. The hallway is closing.';
    try {
      if (publishedStarts.has(r)) endLiveGame(r,null);
      else {
        // Native pixels can arrive before the bus accepts episode.started.
        // The audience has no game to score if validation rejected the start.
        r.startedAt = null;
        Object.assign(r,{phase:'ended',reason:'interrupted',winner:null,finishedAt:Date.now(),action:'stopped'});
      }
    } catch {
      r.stopDetail = publicStatus = 'World could not deliver the round result. The hallway is closing.';
    } finally {
      try { live?.stop(); }
      catch { r.stopDetail = publicStatus = 'World could not confirm the hallway closed.'; }
    }
  }
  function protectLiveCallback(r, callback) {
    return (...args) => {
      try { callback(...args); }
      catch {
        // A subscriber can fail again while delivering the end; the driver
        // must still drain and its terminal callback must remain attached.
        failLiveCallback(r);
      }
    };
  }
  function showExpired(r,now) {
    if (r.clockMode!=='wall' || r.phase==='ended') return false;
    r.remainingMs=Math.max(0,r.showDeadline-now);
    if (r.remainingMs>0) return false;
    nextChapterReady=false;
    continuation=null;
    if (!r.startedAt) {
      interrupt(r,'The show ended before the hallway opened.');
      r.finishedAt=r.showDeadline;
    } else {
      const winner=pendingWinner || 'audience';
      const playing=r.phase==='playing';
      endLiveGame(r,winner);
      if (playing) live?.send({winner});
      else if (activeTicket && !activeTicket.rotating) live?.stop();
    }
    return true;
  }
  function checkChapter(r,now,atLimit=false) {
    r.remainingMs=Math.max(0,r.deadline-now);
    if (!r.remainingMs) {
      const winner=pendingWinner || 'audience';
      endLiveGame(r,winner);
      live?.send({winner});
      return true;
    }
    if (!atLimit && r.deadline<=chapterStartedAt+chapterTiming.limitMs) return false;
    if (!atLimit && now<chapterStartedAt+chapterTiming.cutMs) return false;
    const quiet=placement.holdForHandoff();
    if (quiet && !pendingWinner && !activeTicket.settledFrom && !atLimit) {
      // Preserve the current game state while the last clean native frame
      // is verified. Reads already in flight can refer to a pre-stop view.
      activeTicket.settledFrom=now;
      live.send({pause:true,settleCamera:true,chapterHandoff:true});
    }
    if (quiet && continuation && activeTicket.settledFrom && continuation.at>=activeTicket.settledFrom &&
        continuation.steady && freshObservation(continuation,now,activeTicket.lastMotionAt) && !pendingWinner) {
      activeTicket.rotating=true;
      activeTicket.closeBy=now+35000;
      r.phase='handoff';
      r.deadline=r.clockMode==='wall' ? r.showDeadline : null;
      r.action='Waiting for the next hallway';
      r.intent=null;
      live.stop();
      return true;
    }
    if (atLimit || now>=chapterStartedAt+chapterTiming.limitMs) {
      interrupt(r,'The hallway could not continue from a clear, settled view.');
      return true;
    }
    return false;
  }
  async function update() {
    const r = round,
      now = Date.now();
    if (!r || r.phase === 'ended') return;
    if (r.playMode === 'buffered-live') {
      if (r.deadline != null) r.remainingMs = Math.max(0,r.deadline-now);
      buffered.advance(now);
      return;
    }
    if (r.playMode === 'prepared-show') {
      r.remainingMs = Math.max(0, r.deadline-now);
      if (r.remainingMs) prepared.advance(now);
      else {
        finish(r, null, 'time', r.deadline);
        notifyEnd(r);
      }
      return;
    }
    if (r.live) {
      if (showExpired(r,now)) return;
      if (r.chapters && ((activeTicket?.rotating && now>=activeTicket.closeBy) ||
          (activeTicket && !activeTicket.firstFrame && now>=activeTicket.openBy))) {
        interrupt(r,'The hallway connection did not complete in time.');
        return;
      }
      if (r.chapters && r.phase==='playing' && checkChapter(r,now)) return;
      if (r.phase === 'playing') placement?.tick(now);
      const resuming=r.chapters && r.phase==='handoff' && nextChapterReady && !activeTicket;
      if (resuming || (r.phase === 'opening' && now >= (r.openingEndsAt ?? r.deadline))) {
        nextChapterReady=false;
        if (!resuming) r.phase = 'preparing';
        const ticket={chapter:resuming ? r.chapter+1 : 1,rotating:false,openBy:now+35000,firstFrame:false};
        activeTicket=ticket;
        try {
          live = launchLive({
            episodeId: r.id,
            playMode: r.playMode,
            plannedDurationMs: r.plannedDurationMs,
            dir: captureDir,
            seed:resuming ? continuation.bytes : seed,
            continuation:Boolean(resuming),
            ...(r.chapters ? {chapter:ticket.chapter,chapterMs:chapterTiming.limitMs} : {}),
            onMessage: protectLiveCallback(r, (m) => {
              if (closing || ticket!==activeTicket || r.phase==='ended' || r!==round) return;
              if (showExpired(r,Date.now()) || ticket.rotating) return;
              if (m.chapterExpired && r.chapters && r.phase==='playing') {
                checkChapter(r,Date.now(),true);
                return;
              }
              if (m.winner === 'robot' || m.winner === 'audience') {
                if (r.chapters && (r.phase!=='playing' || pendingWinner!==m.winner)) return;
                endLiveGame(r, m.winner);
                return;
              }
              if (m.frame) {
                ticket.firstFrame=true;
                if (r.phase === 'preparing' || r.phase==='handoff') {
                  const first=!r.startedAt;
                  r.phase = 'playing';
                  const frameAt=Date.now();
                  if (first) r.startedAt=frameAt;
                  if (r.chapters) {
                    r.chapter=ticket.chapter;
                    r.deadline=r.clockMode==='wall' ? r.showDeadline : frameAt+r.remainingMs;
                    chapterStartedAt=frameAt;
                    continuation=null;
                    crossing={};
                    Object.assign(r,{observed:null,trackedAt:null,trackedFeet:null,trackedBody:null,trackedPose:null,
                      trackedDoorwayProgress:null,trackedObstacles:[],intent:null,brainDecision:null,lastMoveHeld:null,lastMoveProposed:null,lastMoveApplied:null,action:'Exploring the hallway'});
                    if (!first) placement.resumeChapter();
                  } else r.deadline=r.providerDeadline || r.startedAt+liveMs;
                  if (first) {
                    const duration=r.clockMode==='wall' ? r.remainingMs : r.chapters ? r.durationMs : liveMs;
                    publishStart(r,r.startedAt,duration);
                  }
                }
                nextVideoChapter(r);
                videoSequence=m.frameNumber || videoSequence+1;
                playout.push(jpegPart(Buffer.from(m.frame,'base64'),videoSequence),videoSequence);
              }
              if (m.expiresAt && !r.chapters) {
                r.providerDeadline = m.expiresAt;
                if (r.phase === 'playing') r.deadline = m.expiresAt;
              }
              if (m.moveHeld && m.moveHeld.observed >= (r.lastMoveHeld?.observed ?? -1))
                r.lastMoveHeld = m.moveHeld;
              if (r.phase==='playing' && m.navigationMoved && m.encounter) placement.applied(m);
              if (r.phase==='playing' && m.stepReview) placement.reviewed(m.stepReview);
              if (m.navigationMoved && r.phase === 'playing' && m.observed >= (r.lastMoveApplied?.observed ?? -1))
                r.lastMoveApplied = {observed:m.observed,key:m.key};
              if (m.cameraMoved) r.lastCameraAt = Date.now();
              if (m.navigationMoved && r.phase === 'playing' && m.observed === r.observed) {
                const prop = r.props.find(p => (!r.chapters || p.chapter===r.chapter) && p.inPath && p.confirmedFrame === m.observed && !p.reactedAt);
                if (prop) r.intent = { hauntId: prop.id, key: m.key, observed: m.observed, at: Date.now() };
              }
              if (m.navigationMoved && m.key === 'W') crossing.forwardAt = Date.now();
              if ((m.cameraMoved || m.navigationMoved) && r.phase === 'playing') {
                placement?.moved();
                ticket.lastMotionAt = Date.now();
                continuation = null;
              }
              if (m.injected && r.phase === 'playing')
                placement?.acknowledged(m.injected, m.attempt ?? 1, m.injectedAt ?? Date.now(), m.injectedFrame);
              if (m.injectionDeferred && r.phase === 'playing') placement?.deferred(m.injectionDeferred, m.attempt, m.observed);
              if (m.injectionFailed && r.phase === 'playing') placement?.failed(m.injectionFailed, m.attempt ?? 1);
              if (
                m.scene &&
                r.phase === 'playing' &&
                Date.now() < r.deadline &&
                !pendingWinner
              ) {
                if (!Number.isInteger(m.observed) || !Number.isFinite(m.observedAt) || m.observedAt > Date.now() ||
                    (r.observed != null && (m.observed <= r.observed || m.observedAt < r.trackedAt))) return;
                if (r.chapters) {
                  const checkpoint=m.checkpoint && checkpointEligible(m.scene,m.trackingNavigationHeld) && Buffer.from(m.checkpoint,'base64');
                  continuation=validCheckpoint(checkpoint) && Number.isFinite(m.observedAt) && m.observedAt<=Date.now()
                    ? {bytes:checkpoint,at:m.observedAt,received:Date.now(),steady:m.trackingPlacementReady===true} : null;
                }
                r.trackedFeet = m.scene.visible && m.scene.feetVisible !== false
                  ? [0, 1].map((i) => Math.round((m.scene.feet.left[i] + m.scene.feet.right[i]) / 2))
                  : null;
                r.trackedAt = m.observedAt;
                r.trackedDoorwayProgress = m.scene.doorwayProgress;
                if (!m.scene.visible) r.intent = null;
                r.trackedBody = m.scene.visible ? m.scene.bodyBox ?? null : null;
                r.trackedPose = m.scene.visible ? m.scene.pose ?? null : null;
                r.trackedObstacles = m.scene.obstacles.map((obstacle) => obstacle.box);
                r.seq++;
                r.brainDecision = null;
                r.observed = m.observed;
                const now = Date.now();
                placement?.observe(m.scene, m.observed, m.observedAt, now, m.trackingPlacementReady !== false, m.guardReview);
                const proposed = m.proposedKey || proposedKey(m.scene);
                if (proposed) r.lastMoveProposed = {observed:m.observed,key:proposed};
                function holdMove(reason, key = proposed) {
                  if (!key || key === 'NOOP') return;
                  const entry = {observed:m.observed, key, reason, source:'world'};
                  r.lastMoveHeld = entry;
                  live.send({moveHeld:entry});
                }
                const encounterHeld = placement.navigationPaused(now);
                const crossed = !encounterHeld && !m.trackingNavigationHeld && observedCrossing(crossing, m.scene, m.observedAt);
                if (crossed || r.fear >= 3) {
                  pendingWinner = crossed ? 'robot' : 'audience';
                  live.send({ winner: pendingWinner });
                } else if (ticket.settledFrom) {
                  holdMove('Holding a chapter continuation frame');
                  r.action='Holding the hallway view';
                  r.intent=null;
                } else if (encounterHeld) {
                  holdMove(placement.holdReason(now));
                  r.action = 'Assessing the path';
                  const prop = r.props.find(p => (!r.chapters || p.chapter===r.chapter) && p.acked && p.sentAt <= m.observedAt && !p.reactedAt &&
                    !['off-path', 'passed', 'failed', 'unverified'].includes(p.placement));
                  if (m.scene.visible && prop)
                    r.intent = { hauntId: prop.id, key: 'assess', observed: m.observed, at: Date.now() };
                } else if (m.trackingNavigationHeld && !placement.canRespond(m.observed)) {
                  holdMove(m.trackingReason || (m.scene.visible ? 'Recovering player framing' : 'Player identity unavailable'));
                  r.action = m.scene.visible ? 'Camera catching up to the robot' : 'Looking for the robot';
                  r.intent = null;
                } else {
                  const decision = pilot(m.scene);
                  r.brainDecision = decision.decision ?? null;
                  r.action = decision.rationale;
                  const crossingStride = canCrossThreshold(crossing, m.scene, decision);
                  const move = crossingStride ? {...decision, action:{key:'W',holdMs:260}} : decision;
                  const command = placement.characterCommand(move, now);
                  if (command && !(m.trackingNavigationHeld && command.key === 'W')) {
                    if (crossingStride) r.action = 'Stepping through the exit';
                    live.send({...command, observed:m.observed});
                  } else if (move.action.key !== 'NOOP') {
                    holdMove(m.trackingNavigationHeld ? 'Forward travel requires recovered player framing' : placement.holdReason(now), move.action.key);
                    r.action = 'Watching the obstacle';
                  } else {
                    holdMove('Brain held the player after checking the observed route');
                  }
                }
              }
              if (m.observationFailed) {
                if (r.chapters) continuation=null;
                r.action = 'Waiting for a clear observation';
                r.intent = null;
                r.trackedBody = null;
              }
            }),
            onClose: protectLiveCallback(r, (terminal) => {
              if (ticket!==activeTicket) return;
              activeTicket=null;
              live = null;
              if (!closing && r===round) showExpired(r,Date.now());
              if (!closing && r===round && r.phase==='handoff' && ticket.rotating && terminal==='completed') {
                r.providerClosedAt=Date.now();
                nextChapterReady=true;
                return;
              }
              r.terminal = terminal || 'unconfirmed';
              const closedAt = Date.now();
              if (['completed', 'canceled', 'cancelled', 'failed'].includes(terminal))
                r.providerClosedAt = closedAt;
              if (r.chapters && r.phase==='handoff') interrupt(r,'The next hallway could not open cleanly.');
              else if (r.phase === 'playing') endLiveGame(r, null);
              else if (r.phase === 'preparing') {
                Object.assign(r, {phase: 'ended', finishedAt: closedAt, reason: 'interrupted'});
              }
            }),
          });
          providerRound = r;
          if (r.callbackFailed) live.stop();
          if (resuming) r.providerClosedAt=null;
        } catch {
          activeTicket=null;
          interrupt(r,'The Genie session could not open.');
        }
      }
      return;
    }
    if (beginPlay(r, now)) publishStart(r, now, playMs);
    if (r.phase !== 'playing') return;
    await updateRehearsal(r, now);
  }
  function publishStart(r, now, duration) {
    const payload = {
      episodeId: r.id,
      sessionId: null,
      mode: r.live ? 'genie' : 'replay',
      driver: 'brain',
      round: number,
      seed: {kind:'image', imagePath:'venue-photo', prompt:'Reach the signed exit in the photographed hallway.'},
      policyVersion: 'v1',
      task: {targetLabel:'exit', instruction:'Reach the exit through the hallway.'},
      startedAt: now,
      maxDurationMs: r.chapters ? Math.min(90_000, chapterTiming.limitMs, duration) : duration,
      ...((r.chapters || r.playMode === 'prepared-show' || r.playMode === 'buffered-live') && {match: {clockMode:r.clockMode, durationMs:r.durationMs,
        ...(r.clockMode === 'wall' && {deadline:r.showDeadline})}}),
    };
    try {
      bus.publish('episode.started','world',payload,r.id);
      publishedStarts.add(r);
    } catch (error) {
      // The bus appends before notifying subscribers. An accepted start with
      // a failing listener must still be closed for consumers that received it.
      if (bus.history?.({episodeId:r.id,types:['episode.started']}).length) publishedStarts.add(r);
      throw error;
    }
  }
  async function updateRehearsal(r, now) {
    if (now >= r.deadline) {
      finish(r, 'audience', 'time', now);
      notifyEnd(r);
      return;
    }
    const waiting = r.upcoming?.[0];
    if (waiting) {
      if (waiting.cueAt == null && !hauntCue({ ...r, upcoming: [] }, now)) waiting.cueAt = now;
      if (waiting.cueAt != null && now - waiting.cueAt >= 1800) placeOffline(r, r.upcoming.shift(), now);
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
        headers: { 'Content-Type': 'application/json', ...(internalBrainToken ? { authorization: 'Bearer ' + internalBrainToken } : {}) },
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
  const timer = setInterval(() => {
    const current = round;
    void update().catch(() => {
      if (current?.playMode === 'buffered-live') {
        buffered?.stop();
        finish(current,null,'interrupted',Date.now());
        notifyEnd(current);
      } else if (current?.live) {
        failLiveCallback(current);
      } else if (current && current === round) {
        finish(current,null,'interrupted',Date.now());
      }
    });
  }, 150);
  app.addHook('onClose', async () => {
    closing=true;
    clearInterval(timer);
    await buffered?.dispose();
    unsubscribe();
    live?.stop();
    playout.reset();
    for (const [stream,viewer] of viewers) {viewer.sink.close();stream.end();}
  });
  function lobbyState() {
    const plate = plateStatus();
    const phase = round?.phase === 'ended' ? 'ended'
      : round?.playMode === 'buffered-live' && round.phase === 'preparing' ? 'lobby'
      : ['playing','handoff'].includes(round?.phase) ? 'playing'
      : round ? 'starting' : lobbyOpenedAt == null ? 'before-photo' : 'lobby';
    return {
      phase, openedAt: lobbyOpenedAt,
      ready: lobbyOpenedAt != null && (!captureDir || plate.plateReady),
      preparing: plate.platePreparing, error: plate.plateError,
    };
  }
  app.get('/rehearsal/lobby', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { ...lobbyState(), ...(runtimeCommit && { runtimeCommit }) };
  });
  app.get('/rehearsal/state', async () => ({
    round,
    lobby: lobbyState(),
    number,
    queue: [...queue.values()],
    preparedAvailable: !custom && preparedEncountersAvailable,
    bufferedAvailable: !!captureDir && canEncode(),
    canLive: !!captureDir,
    cameraTestDurationMs: liveMs,
    approvedVenueOpening: !custom && !!venueOpening,
    providerClosing: !!providerClosing(),
    custom,
    revision,
    ...plateStatus(),
    publicStatus,
    now: Date.now(),
  }));
  app.get('/rehearsal/ghost', async (req, reply) => ({
    name: alias(req, reply),
  }));
  app.post('/rehearsal/start', async (req, reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    const requestedAt=Date.now();
    const showMinutes=req.body?.showMinutes;
    if (showMinutes!==undefined && (![5,10].includes(showMinutes) || req.body?.mode!=='genie' || req.body?.chapters!==true))
      return reply.code(400).send({error:'Choose a 5 or 10 minute chaptered Genie show.'});
    const rolling = req.body?.mode === 'buffered';
    const paid = rolling || req.body?.mode === 'genie';
    const chaptered = !rolling && paid && req.body?.chapters === true;
    if (rolling && (!captureDir || !canEncode())) return reply.code(503).send({error:'The hosted video renderer is unavailable.'});
    if (paid && !rolling && !chaptered && (!Number.isSafeInteger(liveMs) || liveMs <= 0 || liveMs > 90_000))
      return reply.code(400).send({error:'A single Genie camera test must run for 1–90,000 ms. Start a chaptered show for a longer game.'});
    const screening = req.body?.mode === 'prepared';
    if (screening && !preparedEncountersAvailable)
      return reply.code(409).send({error:'No recorded encounter with a verified robot response is ready yet.'});
    if (screening && custom)
      return reply.code(409).send({error:'These scenes were recorded in the venue hallway. Choose the venue photo or start a live game with your photo.'});
    const playMode = rolling ? 'buffered-live' : screening ? 'prepared-show' : !paid ? 'offline-rehearsal' : !chaptered ? 'camera-test'
      : showMinutes === 5 ? 'five-minute-demo' : 'ten-minute-game';
    if (req.body?.expectedPlayMode !== undefined && req.body.expectedPlayMode !== playMode)
      return reply.code(400).send({error: 'The game length changed. Select the duration again before starting.'});
    if (checkingPlayer) return reply.code(409).send({ error: 'The opening shot is being checked.' });
    if (round && round.phase !== 'ended')
      return reply.code(409).send({ error: 'A round is already open.' });
    if (paid) {
      if (providerClosing()) return reply.code(409).send({ error: 'The previous live hallway is still closing.' });
      const runway = () => worldLeaseWarning({mode:rolling ? 'five-minute-demo' : playMode, requestedAt, now:Date.now(),
        durationMs:rolling ? fiveMinuteShowMs : chaptered ? (showMinutes === 5 ? fiveMinuteShowMs : chapterTiming.matchMs) : liveMs,
        openingMs:lobbyOpenedAt == null ? openingMs : 0, cutMs:chapterTiming.cutMs});
      const beforeReview = runway();
      if (beforeReview) return reply.code(409).send(beforeReview);
      if (custom && (!plateStatus().plateReady || req.body?.plateKey !== sourceKey))
        return reply.code(409).send({
          error: 'Prepare this photo for Genie before starting a live round.',
        });
      const useVenueOpening = req.body?.useVenueOpening === true;
      if (useVenueOpening && (custom || !venueOpening))
        return reply.code(409).send({error:'The venue opening does not match this photo. Start with the current hallway.'});
      const candidate = useVenueOpening ? venueOpening.jpeg : Buffer.from(req.body?.seed || '', 'base64');
      if (
        !captureDir ||
        !makePilot ||
        candidate.length < 100 ||
        candidate.length > 48000 ||
        candidate.readUInt16BE(0) !== 0xffd8
      )
        return reply
          .code(400)
          .send({ error: 'The live hallway needs a valid camera seed.' });
      const seedDigest = photoKey(candidate);
      if (custom && seedDigest === venueOpening?.digest)
        return reply.code(409).send({error:'The venue opening does not match the selected photo. Start with the current hallway.'});
      if (custom || seedDigest !== venueOpening?.digest) {
        const reviewKey = sourceKey + '/' + seedDigest;
        let review = seedReviews.get(reviewKey);
        if (!review) {
          const checkedRevision = revision;
          checkingPlayer = true;
          try {
            review = await reviewSeed(candidate, captureDir);
            if (typeof review?.passes !== 'boolean') throw Error('Incomplete opening review');
            seedReviews.set(reviewKey, review);
            if (revision !== checkedRevision)
              return reply.code(409).send({error:'The photo changed. Start with the current photo.'});
          } catch {
            return reply.code(503).send({error:'The opening shot could not be checked. Try again.'});
          } finally {
            checkingPlayer = false;
          }
        }
        if (!review.passes) return reply.code(422).send({error:openingCorrection(review)});
      }
      if (showMinutes===5 && Date.now()>=requestedAt+fiveMinuteShowMs)
        return reply.code(408).send({error:'The five-minute show window ended before the opening was ready.'});
      const beforeOpen = runway();
      if (beforeOpen) return reply.code(409).send(beforeOpen);
      seed = candidate;
    }
    if (buffered?.busy) return reply.code(409).send({error:'The last render is still closing.'});
    if (buffered) { void buffered.dispose(); buffered = null; }
    number++;
    prepared = null;
    playout.reset();
    liveFrame = null;
    pendingWinner = null;
    continuation=null;
    nextChapterReady=false;
    crossing = {};
    placement = null;
    publicStatus = '';
    round = newRound(newId('ep'), Date.now());
    if (lobbyOpenedAt != null) {
      round.openedAt = lobbyOpenedAt;
      round.deadline = Date.now();
    }
    round.live = paid;
    if (chaptered) {
      const wall=showMinutes===5;
      const duration=wall ? fiveMinuteShowMs : chapterTiming.matchMs;
      Object.assign(round,{chapters:true,chapter:1,showMinutes:wall ? 5 : 10,clockMode:wall ? 'wall' : 'active',
        durationMs:duration,remainingMs:duration});
      if (wall) {
        round.openingEndsAt=round.deadline;
        round.showStartedAt=requestedAt;
        round.showDeadline=requestedAt+duration;
        round.deadline=round.showDeadline;
        round.remainingMs=Math.max(0,round.showDeadline-Date.now());
      }
    }
    Object.assign(round, {playMode, requestedAt, plannedDurationMs: chaptered ? round.durationMs : paid ? liveMs : playMs});
    pilot = paid ? makePilot() : null;
    if (screening || rolling) {
      const r = round;
      Object.assign(r,{phase:'playing', startedAt:requestedAt, deadline:requestedAt+fiveMinuteShowMs,
        clockMode:'wall', durationMs:fiveMinuteShowMs, remainingMs:fiveMinuteShowMs,
        plannedDurationMs:fiveMinuteShowMs, showDeadline:requestedAt+fiveMinuteShowMs});
      if (rolling) {
        Object.assign(r,{phase:'preparing',startedAt:null,deadline:null,showDeadline:null,clockMode:'active'});
        buffered = createBufferedShow({id:r.id,seed,start:requestedAt,deadline:requestedAt+fiveMinuteShowMs,
          render:opts => renderBuffered({...opts, makePilot:() => pilot, captureDir}),
          onReceipt:(pick,ok,error) => {
            const now=Date.now();
            if (ok) r.props.push({id:pick.id,name:pick.text,by:pick.by,seen:true,inPath:true,seenAt:now,shownAt:now});
            bus.publish('haunt.injected','world',{hauntId:pick.id,episodeId:r.id,t:Math.max(0,now-(r.startedAt ?? now)),
              ok,simulated:false,...(ok && {sceneEvidence:"generated-in-path"}),...(error && {error})},r.id);
          }, onScare:() => { r.fear++; }, onFinish:(reason,winner) => {
            if (reason==='interrupted') r.stopDetail=buffered.error || 'The hallway did not finish preparing.';
            finish(r,winner,reason,reason==='time' ? r.deadline : Date.now());
            notifyEnd(r);
          }});
        r.prepared = buffered.state;
        r.playbackMetrics = buffered.metrics;
      } else {
        prepared = createPreparedShow(requestedAt, r.deadline, (guest,now) => {
          r.props.push({id:guest.id, name:guest.clip.title, by:guest.by, recorded:true, shownAt:now});
          bus.publish('haunt.injected','world',{hauntId:guest.id,episodeId:r.id,t:now-r.startedAt,
            ok:true,simulated:true,sceneEvidence:"in-recording"},r.id);
        }, 30000, (guest,now) => {
          const reaction = guest.clip.reactionEvidence;
          const flinch = reaction.action === 'recoil' && guest.clip.verifiedScare === true;
          r.lastReaction = {at:now,presentedAt:now,name:guest.clip.title,flinch};
          if (flinch) {
            r.fear++;
            if (r.fear >= 3) {
              finish(r,'audience','fear',now);
              notifyEnd(r);
            }
          }
        },library);
        r.prepared = prepared.state;
      }
      try { publishStart(r,requestedAt,rolling ? Math.min(90_000, chapterTiming.limitMs) : 0); }
      catch {
        buffered?.stop();
        finish(r,null,'interrupted',Date.now());
        notifyEnd(r);
        return reply.code(503).send({error:'The audience room could not open. Try again.'});
      }
    }
    if (paid && !rolling) {
      const r=round;
      placement=createPlacementController(r, command=>live?.send(command), (prop,ok)=>{
        bus.publish('haunt.injected','world',{
          hauntId:prop.id, episodeId:r.id, t:Date.now()-r.startedAt, ok, simulated:false,
          ...(!ok ? {error:'The haunting could not be placed in the visible walking lane.'} : {}),
        },r.id);
      }, { cueLeadMs: 1800 });
    }
    return { id: round.id, playMode, plannedDurationMs: round.plannedDurationMs, openingMs: lobbyOpenedAt == null ? openingMs : 0 };
  });
  app.post('/rehearsal/retry-render', async (req,reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round?.playMode !== 'buffered-live' || round?.phase !== 'preparing' || req.body?.round !== round.id || !buffered.resume())
      return reply.code(409).send({error:'This live lobby has no paused render.'});
    return {id:round.id};
  });
  app.post('/rehearsal/play', async (req,reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round?.playMode !== 'buffered-live' || req.body?.round !== round.id)
      return reply.code(409).send({error:'This live lobby is no longer open.'});
    if (round.phase === 'playing') return {id:round.id,deadline:round.deadline};
    const now=Date.now();
    const lease = worldLeaseWarning({mode:'five-minute-demo',requestedAt:now,now,durationMs:fiveMinuteShowMs,
      openingMs:0,cutMs:chapterTiming.cutMs});
    if (lease) return reply.code(409).send(lease);
    if (round.phase !== 'preparing' || !buffered.play(now))
      return reply.code(409).send({error:'The live opening is still being prepared. Guests can keep sending ideas.'});
    Object.assign(round,{phase:'playing',clockMode:'wall',startedAt:now,showStartedAt:now,
      deadline:now+fiveMinuteShowMs,showDeadline:now+fiveMinuteShowMs,remainingMs:fiveMinuteShowMs});
    return {id:round.id,deadline:round.deadline};
  });
  app.post('/rehearsal/stop', async (req,reply)=>{
    if(req.headers['x-show-control']!=='1') return reply.code(403).send();
    if (round?.playMode === 'buffered-live' && round.phase !== 'ended') {
      round.stopDetail = 'The host ended the game.';
      buffered.stop();
      finish(round,null,'interrupted',Date.now());
      notifyEnd(round);
      return {id:round.id,phase:round.phase};
    }
    if (round?.playMode === 'prepared-show' && round.phase !== 'ended') {
      round.stopDetail = 'The host ended the screening.';
      finish(round,null,'interrupted',Date.now());
      notifyEnd(round);
      return {id:round.id,phase:round.phase};
    }
    if (!round?.live || round.phase==='ended') return reply.code(409).send({error:'There is no live round to stop.'});
    interrupt(round,'The host stopped the hallway.');
    return {id:round.id,phase:round.phase};
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
    sourceKey = photoKey(b);
    lobbyOpenedAt = Date.now();
    if (captureDir) plates.prepare(sourceKey, photo);
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
    sourceKey = 'venue';
    lobbyOpenedAt = Date.now();
    custom = false;
    revision++;
    round = null;
    return { revision };
  });
  app.post('/rehearsal/prepare-photo', async (req, reply) => {
    if (req.headers['x-show-control'] !== '1') return reply.code(403).send();
    if (round && round.phase !== 'ended')
      return reply.code(409).send({ error: 'Prepare photos between rounds.' });
    if (!custom) return plateStatus();
    if (!captureDir)
      return reply.code(503).send({
        error: 'Photo preparation is unavailable on this host.',
      });
    if (req.body?.revision !== undefined && req.body.revision !== revision)
      return reply.code(409).send({ error: 'The selected photo has changed.' });
    const job = plates.prepare(sourceKey, photo);
    return reply.code(job.pending ? 202 : 200).send(plateStatus());
  });
  app.get('/rehearsal/plate', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    if (req.query?.key && req.query.key !== sourceKey)
      return reply.code(409).send({ error: 'The selected photo has changed.' });
    if (!custom) return reply.type('image/webp').send(stockPlate);
    const image = plates.get(sourceKey)?.image;
    if (!image)
      return reply.code(409).send({ error: 'The room is not ready yet.' });
    return reply.type(image.mime).send(image.bytes);
  });
  app.get('/rehearsal/source', async (_, reply) =>
    reply.header('cache-control', 'no-store').type('image/jpeg').send(photo),
  );
  for (const [route, file, mime] of [
    ['/team', 'stage.html', 'text/html'],
    ['/debug', 'stage.html', 'text/html'],
    ['/host-debug.mjs', 'host-debug.mjs', 'text/javascript'],
    ['/stage', 'stage.html', 'text/html'],
    ['/phone', 'phone.html', 'text/html'],
    ['/stage.css', 'stage.css', 'text/css'],
    ['/prepared-player.css', 'prepared-player.css', 'text/css'],
    ['/prepared-player.mjs', 'prepared-player.mjs', 'text/javascript'],
    ['/stage.js', 'stage.js', 'text/javascript'],
    ['/scene.js', 'scene.js', 'text/javascript'],
    ['/look.mjs', 'look.mjs', 'text/javascript'],
    ['/haunt-cue.mjs', 'haunt-cue.mjs', 'text/javascript'],
    ['/veil.mjs', 'veil.mjs', 'text/javascript'],
    ['/photo.js', 'photo.mjs', 'text/javascript'],
    ['/phone.js', 'phone.js', 'text/javascript'],
    ['/hall.webp', 'long-hall.webp', 'image/webp'],
    ['/explorer.webp', 'explorer.webp', 'image/webp'],
    ['/peel.webp', '../painted-door/haunting/peel.webp', 'image/webp'],
  ])
    app.get(route, async (_, reply) =>
      reply.type(mime).send(readFileSync(resolve(root, file))),
    );
  return Object.assign(() => round, {lobbyPhase: () => lobbyState().phase,
    renderWindow: () => round?.playMode === 'buffered-live' && ['preparing','playing'].includes(round.phase) ? buffered.window(Date.now()) : null,
    prepared: () => round?.phase === 'playing' && round?.playMode === 'prepared-show' ? prepared.gate(Date.now()) : null});
}
