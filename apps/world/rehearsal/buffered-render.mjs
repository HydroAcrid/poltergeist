import { execFile, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { providerWaitMs, worldLeaseWarning } from '../../hosting/world-lease.mjs';
import { canCrossThreshold, observedCrossing } from './crossing.mjs';
import { openLive } from './live.mjs';
import { createPlacementController } from './placement.mjs';

const execute = promisify(execFile);
const hostedEncoder = '/vercel/sandbox/tools/node_modules/ffmpeg-static/ffmpeg';
let lastEncoderProbe;

function encoderPath(explicit = process.env.PG_FFMPEG_PATH) {
  const paths = explicit ? [explicit] : [hostedEncoder, 'ffmpeg'];
  const key = JSON.stringify([paths, process.env.PATH]);
  if (lastEncoderProbe?.key === key && Date.now() - lastEncoderProbe.at < 30_000) return lastEncoderProbe.path;
  const path = paths.find(candidate => {
    const result = spawnSync(candidate, ['-hide_banner', '-encoders'], {encoding:'utf8', timeout:1500});
    return result.status === 0 && /\blibx264\b/.test(result.stdout);
  });
  lastEncoderProbe = {key, at:Date.now(), path};
  return path;
}

export function bufferedEncoderReady() {
  return Boolean(encoderPath());
}

const isJPEG = bytes => Buffer.isBuffer(bytes) && bytes.length >= 4 &&
  bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length-2) === 0xffd9;

function newReceipt({id, text, by}) {
  return {
    id, text, by, delivered:false, visible:false, inPath:false, reacted:false, placement:'waiting',
    deliveredFrame:null, visibleFrame:null, inPathFrame:null, reactedFrame:null,
    deliveredOffsetMs:null, visibleOffsetMs:null, inPathOffsetMs:null, reactedOffsetMs:null,
  };
}

// Capture stores every native JPEG before publishing its sampled perception. Projector IPC can
// drop intermediate frames under backpressure, so the movie and continuation come from disk.
async function captureRuns(captureDir) {
  try {
    const entries = await readdir(join(captureDir, 'runs'), {withFileTypes:true});
    return entries.filter(entry => entry.isDirectory() && entry.name.startsWith('photo-round-')).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function takeArchive(captureDir, previous, episodeId, chapter) {
  for (const name of await captureRuns(captureDir)) {
    if (previous.has(name)) continue;
    const path = join(captureDir, 'runs', name);
    let session;
    try { session = JSON.parse(await readFile(join(path, 'session.json'), 'utf8')); }
    catch (error) {
      // A different host request may already have opened its own directory after our child exited.
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
    if (session.episodeId === episodeId && session.chapter === chapter && session.playMode === 'buffered-show') {
      if (session.terminal !== 'completed' || !Number.isSafeInteger(session.frames) || session.frames < 2 || session.fps !== 24)
        throw Error('The native recording was incomplete.');
      const files = new Set(await readdir(path));
      for (let frame = 1; frame <= session.frames; frame++) {
        if (!files.has(String(frame).padStart(5,'0') + '.frame')) throw Error('The native recording is missing a frame.');
      }
      return {path, session};
    }
  }
  throw Error('The native recording for this segment was not found.');
}

function performTake({launchLive, captureDir, seed, picks, durationMs, reactionTailMs, episodeId, chapter, pilot, initialFear, signal, onStart}) {
  return new Promise((resolve, reject) => {
    let live, started = false, selected = false, lastObserved = 0, lastObservedAt = 0, closed = false, failure, closeTimer;
    let reactionTail = false;
    const round = {props:[], fear:initialFear, deadline:0, lastReaction:null};
    const evidence = {picks:picks.map(newReceipt), observations:[], moves:[], winner:null, winnerFrame:null, finalFear:initialFear};
    const byId = new Map(evidence.picks.map(row => [row.id,row]));
    const crossing = {};
    const placement = createPlacementController(round, command => live?.send(command), () => {});
    const stop = error => {
      if (failure || closed) return;
      failure = error;
      // The native broker keeps its single-session lock until confirmed shutdown. Stop waiting
      // on a damaged broker after its own cleanup window; never start a replacement here.
      closeTimer = setTimeout(() => finish(null), providerWaitMs);
      try { live?.stop(); } catch { finish(null); }
    };
    const abort = () => stop(signal.reason ?? new Error('Rendering canceled.'));
    const watchdog = setTimeout(() => stop(Error('The Genie segment exceeded its capture window.')), durationMs+reactionTailMs+providerWaitMs);
    signal?.addEventListener('abort', abort, {once:true});
    const finish = terminal => {
      if (closed) return;
      closed = true;
      clearTimeout(watchdog);
      clearTimeout(closeTimer);
      signal?.removeEventListener('abort', abort);
      placement.finish();
      evidence.finalFear = round.fear;
      for (const row of evidence.picks) row.placement = 'not-placed';
      for (const prop of round.props) {
        const row = byId.get(prop.id);
        row.placement = prop.placement;
        if (prop.response) {
          row.response = {...prop.response};
          if (row.response.outcome === 'awaiting-pixels') row.response.outcome = 'unconfirmed';
        }
      }
      if (failure) reject(failure);
      else if (!started || terminal !== 'completed') reject(Error('Genie closed without a complete native segment.'));
      else resolve(evidence);
    };
    function handle(message) {
      if (failure || closed) return;
      const now = Date.now();
      if (message.reactionTailStarted && started && !reactionTail && reactionTailMs > 0) {
        reactionTail = true;
        round.deadline += reactionTailMs;
        placement.holdForHandoff();
      }
      if (message.frame) {
        if (!started) {
          started = true;
          round.deadline = now+durationMs;
          onStart?.({episodeId,chapter,at:now});
        }
        if (selected) placement.tick(now);
      }
      if (message.navigationMoved && message.encounter) placement.applied(message);
      if (message.stepReview) placement.reviewed(message.stepReview);
      if (message.cameraMoved || message.navigationMoved) placement.moved(now);
      if (message.navigationMoved) {
        if (message.key === 'W') crossing.forwardAt = now;
        evidence.moves.push({observed:message.observed, key:message.key});
      }
      if (message.injected) {
        placement.acknowledged(message.injected, message.attempt ?? 1, message.injectedAt ?? now, message.injectedFrame);
        const row = byId.get(message.injected);
        if (row && round.props.find(prop => prop.id === row.id)?.acked) {
          row.delivered = true;
          if (Number.isInteger(message.injectedFrame)) row.deliveredFrame ??= message.injectedFrame;
        }
      }
      if (message.injectionDeferred) placement.deferred(message.injectionDeferred, message.attempt, message.observed);
      if (message.injectionFailed) placement.failed(message.injectionFailed, message.attempt ?? 1);
      const {scene, observed, observedAt} = message;
      if (!started || evidence.winner || !scene || !Number.isInteger(observed) || observed <= lastObserved ||
          !Number.isFinite(observedAt) || observedAt > now || observedAt < lastObservedAt || now >= round.deadline) return;
      lastObserved = observed;
      lastObservedAt = observedAt;
      const ready = message.trackingPlacementReady === true;
      evidence.observations.push({frame:observed, playerCount:scene.playerCount, visible:scene.visible, ready});
      if (!selected && scene.visible && scene.playerMatch && scene.playerCount === 1) {
        selected = true;
        for (const pick of picks) placement.add(pick.id, pick.text, pick.by, now);
      }
      placement.observe(scene, observed, observedAt, now, ready);
      for (const prop of round.props) {
        const row = byId.get(prop.id);
        if (prop.seen && !row.visible) { row.visible = true; row.visibleFrame = observed; }
        if (prop.inPath && prop.confirmedFrame === observed && !row.inPath) { row.inPath = true; row.inPathFrame = observed; }
        if (prop.reactedAt && !row.reacted) {
          row.reacted = true;
          row.reactedFrame = observed;
          row.reaction = prop.observedReaction;
          row.scare = prop.observedReaction === 'scare';
        }
      }
      if (reactionTail) return; // The final picture can verify the previous response, but cannot initiate new travel.
      const held = placement.navigationPaused(now);
      if ((!held && !message.trackingNavigationHeld && observedCrossing(crossing, scene, observedAt)) || round.fear >= 3) {
        evidence.winner = round.fear >= 3 ? 'audience' : 'robot';
        evidence.winnerFrame = observed;
        live?.send({winner:evidence.winner});
        return;
      }
      if (!scene.visible || !scene.playerMatch || scene.playerCount !== 1 || held || (message.trackingNavigationHeld && !placement.canRespond(observed))) return;
      let decision = pilot(scene);
      if (canCrossThreshold(crossing, scene, decision)) decision = {...decision, action:{key:'W',holdMs:260}};
      const command = placement.characterCommand(decision, now);
      if (command && !(message.trackingNavigationHeld && command.key === 'W')) live?.send({...command,observed});
    }
    try {
      signal?.throwIfAborted();
      live = launchLive({dir:captureDir, seed, episodeId, playMode:'buffered-show', plannedDurationMs:durationMs,
        chapter, chapterMs:durationMs, reactionTailMs,
        onMessage(message) {try { handle(message); } catch(error) { stop(error); }},
        onClose:finish,
      });
      if (failure) live.stop();
    } catch (error) {
      failure = error;
      finish(null);
    }
  });
}

export async function renderSegment({
  seed, picks = [], durationMs, episodeId, chapter = 1, makePilot, captureDir,
  outputDir = tmpdir(), initialFear = 0, reactionTailMs = 0, signal, onStart, launchLive = openLive, ffmpegPath,
}) {
  signal?.throwIfAborted();
  if (!isJPEG(seed) || !Number.isSafeInteger(durationMs) || durationMs <= 0 || !episodeId ||
      !Number.isSafeInteger(chapter) || chapter < 1 || !Number.isSafeInteger(initialFear) || initialFear < 0 || !captureDir || typeof makePilot !== 'function')
    throw Error('A JPEG seed, segment duration, episode and World pilot are required.');
  if (!Number.isSafeInteger(reactionTailMs) || reactionTailMs < 0 || reactionTailMs > 8000 ||
      durationMs + reactionTailMs > 90000) throw Error('The response reserve must fit inside the native capture window.');
  if (!Array.isArray(picks) || !picks.every(p => p && typeof p.id === 'string' && p.id && typeof p.text === 'string' && p.text.trim()) ||
      new Set(picks.map(p => p.id)).size !== picks.length) throw Error('Each selected haunting needs its own ID and approved text.');
  const encoder = encoderPath(ffmpegPath);
  if (!encoder) throw Error('An H.264 encoder is unavailable on the World host.');
  const warning = worldLeaseWarning({mode:'camera-test', durationMs:durationMs+reactionTailMs, requestedAt:Date.now()});
  if (warning) throw Error(warning.error);
  await mkdir(outputDir, {recursive:true});
  const work = await mkdtemp(join(outputDir, 'poltergeist-segment-'));
  const dispose = () => rm(work, {recursive:true, force:true});
  try {
    const pilot = makePilot();
    if (typeof pilot !== 'function') throw Error('The World pilot is unavailable.');
    const previous = new Set(await captureRuns(captureDir));
    const evidence = await performTake({launchLive, captureDir, seed, picks, durationMs, reactionTailMs, episodeId, chapter, pilot, initialFear, signal, onStart});
    signal?.throwIfAborted();
    const {path, session} = await takeArchive(captureDir, previous, episodeId, chapter);
    const {frames:frameCount, fps} = session;
    if (chapter > 1) {
      const {compareOpening} = await import('../painted-door/scene-continuity.mjs');
      const sampleNumbers = [...new Set([1, Math.min(12,frameCount), Math.min(24,frameCount)])];
      const samples = await Promise.all(sampleNumbers.map(async frame => ({
        frame, bytes:await readFile(join(path,String(frame).padStart(5,'0')+'.frame')),
      })));
      evidence.continuity = compareOpening(seed,samples);
      if (!evidence.continuity.matches) {
        const error=Error('The next scene opened in a different view of the hallway.');
        error.code='HALLWAY_MISMATCH';
        throw error;
      }
    }
    const finalFrame = await readFile(join(path, String(frameCount).padStart(5,'0') + '.frame'));
    if (!isJPEG(finalFrame)) throw Error('The final native frame was not a complete JPEG.');
    const partial = join(work,'encoding.mp4'), filePath = join(work,'segment.mp4');
    const openingHold = chapter > 1 ? Math.round(fps*2/3) : 0;
    const outputFrames = frameCount + openingHold;
    const inputs = ['-f','image2','-framerate',String(fps),'-start_number','1','-i',join(path,'%05d.frame')];
    const selection = [];
    if (openingHold) {
      // Reveal the exact previous native image; the next generated second has
      // already been checked against it. Keep all generated frames and events.
      const anchor = join(work,'previous.jpg');
      await writeFile(anchor,seed,{mode:0o600});
      inputs.push('-loop','1','-framerate',String(fps),'-i',anchor);
      selection.push('-filter_complex',
        '[1:v]trim=end_frame='+openingHold+',setpts=PTS-STARTPTS,format=yuv420p[a];'+
        '[0:v]setpts=PTS-STARTPTS,format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[out]', '-map','[out]');
    }
    await execute(encoder, ['-nostdin','-hide_banner','-loglevel','error','-xerror','-threads','1',
      ...inputs,...selection,'-frames:v',String(outputFrames),'-an','-c:v','libx264','-threads','2',
      '-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1',partial],
    {signal,maxBuffer:128_000}).then(({stdout}) => {
      const written = [...stdout.matchAll(/^frame=(\d+)$/gm)].at(-1);
      if (Number(written?.[1]) !== outputFrames) throw Error('The playable segment did not contain every native frame.');
    });
    const presentationTime = frame => Math.round((openingHold+frame-1)*1000/fps);
    for (const pick of evidence.picks) for (const event of ['delivered','visible','inPath','reacted']) {
      const frame = pick[event+'Frame'];
      if (frame != null) pick[event+'OffsetMs'] = presentationTime(frame);
    }
    for (const move of evidence.moves) {
      const event = session.events?.find(e => e.observed === move.observed && e.action === 'Player applied '+move.key);
      if (Number.isSafeInteger(event?.frame)) {
        move.appliedFrame = event.frame;
        move.appliedOffsetMs = presentationTime(event.frame);
      }
    }
    evidence.winnerOffsetMs = evidence.winnerFrame == null ? null : presentationTime(evidence.winnerFrame);
    await chmod(partial,0o400);
    await rename(partial,filePath);
    signal?.throwIfAborted();
    return {filePath, finalFrame, fps, frameCount, openingHoldFrames:openingHold, durationMs:Math.round(outputFrames*1000/fps), evidence, dispose};
  } catch (error) {
    await dispose();
    throw error;
  }
}
