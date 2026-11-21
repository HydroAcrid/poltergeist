import {createGuardPickup,guardInstruction} from './defensive-pickup.mjs';
import { frameSink } from '../rehearsal/video-stream.mjs';
import { createNativeFollow, characterInstruction, reactionInstruction, holdIfUntracked, receding, createMoveWindow, createPlacementView, recoveryWatchdogMs, shoulderStride } from './native-follow.mjs';
import { checkpointEligible } from '../rehearsal/chapters.mjs';
import { proposedKey } from '../rehearsal/move-trace.mjs';
import { isEncounterStep, reviewableFrame, responseWatchdogMs, remainingReactionTail, sameReviewSubject } from './response-window.mjs';
import { createEncounterControls } from './encounter-controls.mjs';
import { chapterSeed } from './chapter-seed.mjs';
import { assessFraming } from './framing-report.mjs';
import { audienceView, hallwayLighting } from '../rehearsal/look.mjs';
import { GoogleGenAI } from '@google/genai';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { inspectRoom } from '../rehearsal/live-perception.mjs';
import { cameraPrompt, cameraPilot } from './camera-pilot.mjs';

const seed = 'First-person eye-level view inside a bright old cinema lobby. A wide cream plaster wall faces the camera square on, three metres away. The left half of this wall is completely bare. On the far right is one real dark green door with a deep jamb. Burgundy carpet, brass sconces, warm light. Camera still. No people.';
const proposal = 'Paint a life-size red exit door directly onto the blank left half of the wall. Its frame, handle and shadows are flat brushstrokes on the plaster. Keep the real green door on the right unchanged.';
const archProposal = 'Paint a narrow, life-size red door with a knob directly onto the beige wall to the right of the wood arch. It is a flat painting. Keep the wood arch and green alcove open and unchanged.';
const ghostWalk = 'A single life-size ghost in a flowing ivory sheet steps into the foreground of the wooden aisle, turns its back to the camera and walks steadily away down the middle of the hall. Two feet take alternating footsteps, the hem sways, and the ghost gets smaller as it passes the stools on its way to the booths. The camera stays fixed.';
const bananaPeel = 'One bright yellow empty banana peel now lies on the wooden floor in the clear center of the walking aisle, in the foreground two meters from the camera. Its stem points up and its three yellow flaps spread flat on the wood. The peel stays there. Same hallway, same people, fixed camera.';

function sequenceFor(values) {
  if (values.drive || values['two-moves'] || values['chair-test'] || values.round) return { trick: null, moves: new Map(), endFrame: Infinity };
  if (values['ghost-walk']) {
    return { trick: ghostWalk, moves: new Map(), endFrame: 288 };
  }
  if (values.photo) {
    // Both arch runs follow the same route so their footage can be compared.
    return { trick: values.haunt ? archProposal : null, endFrame: 456, moves: new Map([
      [72, ['key_down', 'key_d']], [84, ['key_up', 'key_d']],
      [108, ['key_down', 'key_a']], [120, ['key_up', 'key_a']],
      [144, ['key_down', 'key_w']], [432, ['key_up', 'key_w']],
    ]) };
  }
  return { trick: proposal, endFrame: 216, moves: new Map([
    [144, ['key_down', 'key_d']], [168, ['key_up', 'key_d']],
  ]) };
}

async function capture() {
  const { values } = parseArgs({ options: {
    live: { type: 'boolean' }, photo: { type: 'string' }, haunt: { type: 'boolean' },
    'ghost-walk': { type: 'boolean' }, 'two-moves': { type: 'boolean' }, 'chair-test': { type: 'boolean' }, round: { type: 'boolean' }, 'stage-pilot': { type: 'boolean' }, drive: { type: 'boolean' },
  } });
  if (values.drive && (!process.send || !values.photo || values.haunt || values['ghost-walk'])) {
    throw new Error('Start manual driving from the local operator page.');
  }
  const autonomous = values['two-moves'] || values['chair-test'] || values.round;
  const stagePilot = values['stage-pilot'];
  const chapterNumber = Number(process.env.PG_WORLD_CHAPTER) || 0;
  const stageDurationMs = Number(process.env.PG_REHEARSAL_LIVE_MS || 45000);
  const reactionTailMs = process.env.PG_WORLD_PLAY_MODE === 'buffered-show' ? Number(process.env.PG_WORLD_REACTION_TAIL_MS || 0) : 0;
  const playerReference = stagePilot ? readFileSync(new URL('../rehearsal/explorer.webp', import.meta.url)).toString('base64') : null;
  if (stagePilot && (!values.round || !process.send)) throw Error('Start the spectator round from the World broker.');
  if (values.round) {
    if (values['two-moves'] || values['chair-test']) throw new Error('Choose a single round mode.');
    values.photo ??= '../robot-v1/hallway-seed.jpg';
  }
  const publish = data => { if (process.connected) process.send(data, () => {}); };
  if (autonomous && (!values.photo || values.drive || values.haunt || values['ghost-walk'])) throw new Error('Use --two-moves with a hallway photo and no other mode.');
  const ghost = values['ghost-walk'];
  if (ghost && (!values.photo || values.haunt)) throw new Error('Use --ghost-walk with --photo and no other effect.');
  if (values.haunt && !values.photo) throw new Error('--haunt needs a photo of the arch.');
  if (process.env.PG_ALLOW_GENIE !== '1' || !values.live) {
    throw new Error('To start one paid Genie session, set PG_ALLOW_GENIE=1 and pass --live.');
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY.');
  const setup = { event_type: 'world_setup' };
  if (values.photo) {
    const jpg = readFileSync(values.photo);
    if (jpg[0] !== 0xff || jpg[1] !== 0xd8 ) {
      throw new Error('Use a landscape JPEG seed.');
    }
    setup.reference_image = { mime_type: 'image/jpeg', data: jpg.toString('base64') };
  } else {
    setup.world_prompt = { text: seed };
  }
  if (autonomous) setup.world_prompt = { text: cameraPrompt };
  if (values.round) setup.world_prompt.text += ' Keep the same small cautious robot, orange twin-strap backpack and lit brass-rim flashlight in its RIGHT hand. Preserve the dark room and warm beam from the seed. It walks toward the signed exit with both feet on the floor.';
  if (stagePilot) setup.world_prompt.text = [
    hallwayLighting,
    "The reference image already contains the entire cast: one explorer at lower left. Animate that existing foreground figure for the entire take. The aisle ahead contains only the room and the invited obstacles. Preserve its helmet, orange backpack, flashlight and scale throughout.",
    audienceView,
    "The explorer waits with both boots planted, breathing and moving its flashlight in place. Only a travel instruction initiates a step. At the end of each instructed movement it plants its feet and waits, even if an object moves. Long connected bays, familiar lamps and flooring continue toward a distant illuminated exit in the upper right. Keep the next few unobstructed steps on-screen; the robot can halt, turn, or move around a visible encounter."
  ].join(" ");
  const { trick, moves, endFrame } = sequenceFor(values);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' });
  const request = { retries: { strategy: 'none' }, timeout_ms: 10000 };
  mkdirSync('runs', { recursive: true });
  const lock = join('runs', 'active-session');
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('A capture is already active or its shutdown has not been verified.');
    throw error;
  }
  const out = mkdtempSync(values.photo ? 'runs/photo-round-' : 'runs/painted-door-');
  const log = { episodeId: process.env.PG_WORLD_EPISODE_ID, ...(chapterNumber ? {chapter:chapterNumber} : {}),
    ...(stagePilot && process.env.PG_WORLD_PLAY_MODE ? {playMode:process.env.PG_WORLD_PLAY_MODE,
      plannedDurationMs:Number(process.env.PG_WORLD_PLANNED_DURATION_MS)} : {}), seed: values.photo ? basename(values.photo) : seed, proposal: trick, fps: 24, frames: 0, events: [], terminal: null };
  const save = () => writeFileSync(join(out, 'session.json'), JSON.stringify(log, null, 2));
  const record = (action, context = {}) => {
    if (values.round) publish({event: action, move: context.applied, observation: context.forwardObstacle});
    log.events.push({ frame: log.frames, action, ...context });
    save();
    console.log('Frame', log.frames, action);
  };

  let interaction;
  let session;
  let watchdog;
  let releaseKey;
  let ending = false;
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Capture stopped.'));
  const previewFrames=frameSink((message,done)=>{
    if (!process.connected) {done(new Error('World host disconnected'));return;}
    process.send(message,error=>{done(error);if(error) stop();});
  },6);
  const stopDuringSetup=command=>{if (command==='end') stop();};
  if (values.round) process.on('message',stopDuringSetup);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  if (values.drive || values.round) process.once('disconnect', stop);
  let gameClock, looking=false, nextLook=0;
  const continuationSeed=stagePilot && process.env.PG_WORLD_CONTINUATION==='1' && setup.reference_image
    ? Buffer.from(setup.reference_image.data,'base64') : null;
  const follow = stagePilot ? createNativeFollow({continuationSeed}) : null;
  const moveWindow = createMoveWindow(log.fps);
  const placementView = createPlacementView();
  const encounter = createEncounterControls();
  const guard = createGuardPickup(log.fps);
  let commands = Promise.resolve(), actorStepTimer;
  let closingOnResponse = false;
  let reviewing = null, lastSight = null, lastStepFeedback = null;
  function finishReview(step, observed, reason) {
    if (!step || reviewing !== step) return false;
    reviewing = null;
    clearTimeout(actorStepTimer);
    publish({stepReview:{encounter:step.encounter,key:step.key,basis:step.basis,appliedFrame:step.appliedFrame,
      observed,reason}});
    record('Checked encounter step',{key:step.key,basis:step.basis,appliedFrame:step.appliedFrame,observed,reason});
    return true;
  }
  let actorStopping=null, actionPending=false, lastRecoveryObservation=-1;
  function heldMove(command, reason) {
    const entry = { observed:command.observed, key:command.key, source:'native', reason };
    record('Move held', entry);
    publish({moveHeld:entry});
  }
  const motionBoundary = () => moveWindow.settledFrame(log.frames,Date.now());
  const noteMotion = () => placementView.moved(motionBoundary());
  let settlingChapter = false, holdChapterCamera = false;
  const cameraAllowed = () => !holdChapterCamera && !ending && !encounter.held && !guard.active && Date.now()>=steadyUntil && !placementView.held(Date.now());
  const moving = () => Boolean(cameraPress || actorMoving || actorStopping || actionPending);
  let cameraPress=null, lookRelease, steadyUntil=0, actorMoving=false, placedHoldUntil=0, recoveryRequested=false;
  async function releaseCamera(completing=false) {
    const press=cameraPress;
    if(!press) return;
    if(!press.release) {
      clearTimeout(lookRelease);
      press.release=(async()=>{
        try{
          await press.down;
          if(!ending || completing) {
            for(const key of press.keys) await session.send({event_type:'user_action',action:'key_up',input:key});
            noteMotion();
            publish({cameraMoved:true});
            if (press.recovery) record('Released shoulder recovery',{observed:press.observed,heldMs:Date.now()-press.startedAt});
          }
        } finally { if(cameraPress===press) cameraPress=null; }
      })();
    }
    await press.release;
  }
  async function aim(step,frame) {
    if(!cameraAllowed() || cameraPress) return;
    const press={keys:[step.key,step.lateralKey].filter(Boolean), stride:step.reason==='match forward stride', recovery:step.reason==='recover shoulder distance'};
    if(press.recovery) {
      if(step.observed===lastRecoveryObservation) return;
      lastRecoveryObservation=step.observed;
      press.observed=step.observed;
      press.minRenewFrame=motionBoundary();
      press.startedAt=Date.now();
    }
    cameraPress=press;
    noteMotion();
    press.down=(async()=>{for(const key of press.keys) await session.send({event_type:'user_action',action:'key_down',input:key});})();
    await press.down;
    publish({cameraMoved:true});
    record('Camera reframed the robot',{...step,frame});
    if(!press.release && !ending) lookRelease=setTimeout(()=>releaseCamera().catch(error=>abort.abort(error)),step.ms);
  }
  function unsafeForwardPress(subject) {
    if (!cameraPress?.keys.includes('key_w')) return false;
    if (cameraPress.recovery) return !subject.cameraRecovery;
    return cameraPress.stride ? !shoulderStride(subject) : !receding(subject);
  }
  async function stopActor(force=false) {
    clearTimeout(actorStepTimer);
    if(actorStopping) return actorStopping;
    if(!actorMoving && !force) return;
    actorMoving=false;
    noteMotion();
    actorStopping=session.send("Stop the existing explorer on its current floorboards now. Both boots stay planted on those boards while the flashlight and breathing move subtly. Hold camera position, angle and distance until a new movement instruction.");
    try { await actorStopping; noteMotion(); record('Paused robot travel'); }
    finally { actorStopping=null; }
  }
  async function updateShot(frame) {
    const lock = follow.status();
    if (unsafeForwardPress(lock) || lock.distanceHeld && cameraPress && !cameraPress.recovery)
      await releaseCamera();
    if (encounter.held || guard.active) {
      // A stationary camera stays held through the independent comparison.
      // Losing a moving texture between two semantic reads cannot identify a different actor.
      if (cameraPress) await releaseCamera();
      return !follow.permits('W');
    }
    if (lock.cameraRecovery) {
      await stopActor();
      if (cameraPress?.recovery && !cameraPress.release && cameraAllowed() &&
          lock.observed>cameraPress.observed && lock.observed>=cameraPress.minRenewFrame) {
        // Only post-command, independently verified pixels may extend a held key.
        clearTimeout(lookRelease);
        cameraPress.observed=lastRecoveryObservation=lock.observed;
        lookRelease=setTimeout(()=>releaseCamera().catch(error=>abort.abort(error)),recoveryWatchdogMs);
        record('Continued shoulder recovery',{observed:lock.observed,bodyWidth:lock.bodyWidth});
      }
      if (!cameraPress && cameraAllowed()) {
        const step = follow.correction(Date.now());
        if (step) await aim(step,frame);
      }
      return true; // Hold player travel while the camera catches up.
    }
    const held = await holdIfUntracked(lock,releaseCamera,stopActor);
    if (!held && !cameraPress && cameraAllowed()) {
      const step=follow.correction(Date.now());
      if (step) await aim(step,frame);
    }
    return held;
  }
  if (autonomous) watchdog = setTimeout(stop, stagePilot ? stageDurationMs + reactionTailMs + 35000 : values.round ? 60000 : 45000);
  try {
    interaction = await ai.interactions.create({ model: 'genie-4', api_version: 'v1beta' }, request);
    abort.signal.throwIfAborted();
    log.interactionId = interaction.id;
    save();
    console.log('Recording in', out);
    session = await ai.interactions.connect(interaction.id, { transport: 'websocket', api_version: 'v1beta' }, request);
    abort.signal.throwIfAborted();
    await session.send(setup);
    const finish = async (winner) => {
      if (ending) return;
      ending = true;
      clearTimeout(gameClock);
      clearTimeout(actorStepTimer);
      await releaseCamera(true);
      if (winner) {
        log.winner = winner;
        record(winner === 'robot' ? 'Robot reached the exit' : 'Audience wins on time');
        publish({winner});
      }
      await session.complete();
    };
    const pilot = autonomous && !stagePilot && cameraPilot({ ai, model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview', send: event => ending ? Promise.resolve() : session.send(event), record, finish, fail: error => abort.abort(error), signal: abort.signal, chairTest: values['chair-test'], gameRound: values.round, isActive: () => !ending });
    if (values.round) process.on('message', command => {
      if (ending) return;
      if (stagePilot && command?.moveHeld) {
        record('Move held', command.moveHeld);
        return;
      }
      // Revoke travel immediately. The queued stop follows any instruction
      // already on the wire, before an injection may reserve a stationary frame.
      if (stagePilot && command?.stepFeedback) {
        const feedback=command.stepFeedback;
        if (lastStepFeedback?.appliedFrame===feedback.appliedFrame && lastStepFeedback.encounter===feedback.encounter) {
          lastStepFeedback.outcome=feedback.outcome;
          record('Observed encounter response',{key:lastStepFeedback.key,appliedFrame:feedback.appliedFrame,
            observed:feedback.observed,outcome:feedback.outcome});
          if (closingOnResponse) finish().catch(error=>abort.abort(error));
        }
        return;
      }
      if (stagePilot && command?.releaseEncounter) {
        if (reviewing?.encounter === command.releaseEncounter && finishReview(reviewing,null,'encounter closed'))
          stopActor().catch(error=>abort.abort(error));
        if (lastStepFeedback?.encounter === command.releaseEncounter && lastStepFeedback.outcome!=='route-open') lastStepFeedback=null;
        encounter.release(command.releaseEncounter, motionBoundary() - 1);
        return;
      }
      if (closingOnResponse && command !== 'end') return;
      if (stagePilot && command?.pause && command.encounter) {
        if (!encounter.hold(command.encounter)) return;
        lastStepFeedback=null;
        releaseCamera().catch(error => abort.abort(error));
      }
      commands = commands.then(async () => {
        if (ending) return;
        if (stagePilot && command?.haunt) {
          const haunt = command.haunt;
          if (!encounter.canPlace(haunt.id, haunt.attempt)) return;
          const lock = follow.status();
          const targetValid=Array.isArray(haunt.target) && haunt.target.length===2 &&
            haunt.target.every(n=>Number.isFinite(n) && n>=0 && n<=1000);
          if (guard.active || !targetValid || !encounter.canPlace(haunt.id, haunt.attempt, haunt.observed) || !placementView.reserve(haunt.observed,follow.permitsPlacement(haunt.observed),moving())) {
            publish({injectionDeferred:haunt.id, attempt:haunt.attempt, observed:haunt.observed});
            record('Held placement for a current single-player view',{id:haunt.id,attempt:haunt.attempt,observed:haunt.observed,holdReason:lock.holdReason});
            return;
          }
          encounter.placing(haunt.id, haunt.attempt);
          const [y, x] = haunt.target || [];
          const location = Number.isFinite(y) && Number.isFinite(x)
            ? `The robot's planned next footfall is at ${Math.round(x/10)} percent across and ${Math.round(y/10)} percent down this view.`
            : "Place it across the walking line joining the robot’s boots and the next stretch of walkable floor.";
          const instruction = [haunt.text, location, haunt.hint,
            "The selected effect occupies that part of the aisle throughout the explorer’s assessment and next move. A moving effect keeps crossing or circling there; a solid obstacle comes to rest there. Let it clear only after the explorer responds.",
            "Continue this same shot. Both boots stay parked, with the flashlight aimed at the effect. Keep the effect and its relation to the explorer visible together. Hold the observer still and wait for the next player instruction."].filter(Boolean).join(" ");
          try {
            // A placement leaves the actor and camera still. Its acknowledgement
            // watermark and the newly visible obstacle qualify the first response
            // frame. A travel cooldown here dropped that first Brain decision.
            await session.send(instruction);
            const injectedFrame = motionBoundary() - 1;
            encounter.acknowledge(haunt.id, haunt.attempt, injectedFrame);
            publish({injected:haunt.id, attempt:haunt.attempt, injectedAt:Date.now(), injectedFrame});
            record('Audience intervention sent',{id:haunt.id,attempt:haunt.attempt,text:haunt.text,target:haunt.target});
          } catch (error) {
            publish({injectionFailed:haunt.id, attempt:haunt.attempt});
            throw error;
          } finally { placementView.finish(Date.now()); }
        } else if (stagePilot && command?.pause) {
          if (chapterNumber && command.chapterHandoff) settlingChapter = true;
          const now=Date.now();
          const force=Boolean(command.encounter) || (command.settleCamera && now>=placedHoldUntil);
          steadyUntil=now+2700;
          moveWindow.settle(log.frames, now, .5);
          if(command.settleCamera) {
            placedHoldUntil=steadyUntil;
            placementView.pause(now);
            noteMotion();
          }
          await Promise.all([releaseCamera(),guard.active ? undefined : stopActor(force)]);
          record(command.settleCamera ? 'Held the camera for placement' : 'Paused at the encounter');
        } else if(stagePilot && !command?.key && command?.reaction) {
          const isGuard=command.reaction==='guard';
          if (!isGuard && command.reaction!=='notice') return;
          const instruction=isGuard ? guardInstruction(command.guard) : reactionInstruction(command);
          const authorized = () => encounter.permits(command) && follow.permitsPlacement(command.observed);
          if (!instruction || guard.active || reviewing || !authorized()) return;
          moveWindow.settle(log.frames, Date.now(), 1);
          await releaseCamera();
          await stopActor();
          if(!authorized() || (isGuard && !guard.reserve(command,lastSight))) return;
          encounter.acted();
          actionPending=true;
          let guardFrame;
          try {
            noteMotion();
            await session.send(instruction);
            if (isGuard) { guardFrame=motionBoundary()-1; guard.applied(guardFrame,Date.now()); }
            lastStepFeedback=null;
          } catch(error) { if(isGuard) guard.cancel(); throw error; }
          finally { noteMotion(); actionPending=false; }
          record('Requested robot reaction',{reaction:command.reaction,guard:command.guard,encounter:command.encounter,toward:command.toward,observed:command.observed,appliedFrame:guardFrame});
        } else if(stagePilot && command?.key) {
          // A wider but grounded view can show a bounded sidestep, retreat or
          // flashlight turn. Keep the observer still, and reserve forward travel
          // for the normal tracked shoulder shot.
          const wideResponse = () => command.encounter && command.key !== 'W' &&
            follow.status().distanceHeld && follow.permitsPlacement(command.observed);
          const reasonHeld = () => {
            if (!encounter.permits(command)) return encounter.held
              ? 'Waiting for the current encounter and its stationary post-effect frame'
              : 'Decision predates the end of the encounter';
            const lock = follow.status();
            if (lock.observed !== command.observed) return 'A newer player observation superseded the decision';
            if (!follow.permits(command.key) && !wideResponse()) return lock.holdReason || 'Player tracking does not permit travel';
            if (!command.encounter && !cameraAllowed()) return placementView.held(Date.now())
              ? 'Camera is held for a stationary placement view' : 'Camera is settling';
            return null;
          };
          if (guard.active) return heldMove(command,'Waiting for the explorer to complete its defensive pose');
          if (reviewing) return heldMove(command,'Waiting for visual feedback from the previous step');
          let reason = reasonHeld();
          if (reason) return heldMove(command, reason);
          const instruction=characterInstruction(command);
          if(!instruction) return heldMove(command, 'Unsupported native movement');
          const subject = follow.status();
          const wallTime = Date.now(), wide = Boolean(wideResponse());
          if (!moveWindow.accept(command, subject, log.frames, wallTime, wide))
            return heldMove(command, moveWindow.reason(command, subject, log.frames, wallTime, wide));
          const stride = !command.encounter && command.key === 'W' ? shoulderStride(subject) : null;
          if (cameraPress && (stride || cameraPress.keys.includes('key_w'))) {
            await releaseCamera();
            reason = reasonHeld();
            if (reason) return heldMove(command, reason);
          }
          const basis = lastSight?.observed===command.observed ? lastSight : null;
          const basisImage = basis?.image;
          if (isEncounterStep(command) && !basisImage) return heldMove(command,'Missing the before-step reference image');
          clearTimeout(actorStepTimer);
          encounter.acted();
          actorMoving=['W','A','S','D'].includes(command.key);
          noteMotion();
          actionPending=true;
          try { await Promise.all([session.send(instruction), stride && aim(stride, log.frames)]); }
          finally { noteMotion(); actionPending=false; }
          const appliedFrame=motionBoundary()-1;
          lastStepFeedback=basisImage ? {encounter:command.encounter,key:command.key,basis:command.observed,
            appliedFrame,basisImage,basisScene:basis.scene,at:Date.now(),outcome:'awaiting-pixels'} : null;
          if (isEncounterStep(command) && encounter.held && lastStepFeedback) {
            const step=lastStepFeedback;
            reviewing=step;
            actorStepTimer=setTimeout(()=>{
              if (finishReview(step,null,'vision timeout')) stopActor().catch(error=>abort.abort(error));
            },responseWatchdogMs);
          } else if (actorMoving && (!encounter.held || command.encounter)) {
            actorStepTimer = setTimeout(() => stopActor().catch(error => abort.abort(error)), 1050);
          }
          publish({navigationMoved:true,key:command.key,observed:command.observed,appliedFrame,
            ...(command.encounter ? {encounter:command.encounter} : {})});
          record('Player applied '+command.key,{observed:command.observed,holdMs:command.ms,appliedFrame,reaction:command.reaction,...(command.landing && {landing:command.landing}),transport:'world action',frame:log.frames});
        } else if (stagePilot && command?.winner) await finish(command.winner);
        else if (command === 'end') await finish();
        else if (command === 'chair' || command === 'peel') {
          const object = command === 'chair' ? 'One bright yellow cafe chair stands sideways' : 'A yellow banana peel lies flat';
          await session.send(object + ' in the flashlight beam on the open floor three or four robot strides ahead. It stays still and leaves a visible route to the right. Keep the same robot and camera.');
          record(command === 'chair' ? 'Audience requested a chair' : 'Audience requested a peel');
        }
      }).catch(error => abort.abort(error));
    });
    if (values.round) { process.off('message',stopDuringSetup); publish({controlsReady:true}); }
    if (values.drive) {
      const controls = new Set(['key_w', 'key_a', 'key_s', 'key_d', 'arrow_left', 'arrow_right']);
      let stepping = false;
      process.on('message', async command => {
        if (ending) return;
        try {
          if (command === 'end') {
            ending = true;
            await session.complete();
            record('Operator ended session');
          } else if (command === 'peel') {
            await session.send(bananaPeel);
            record('Banana peel requested');
          } else if (controls.has(command) && !stepping) {
            stepping = true;
            await session.send({ event_type: 'user_action', action: 'key_down', input: command });
            record('Step ' + command);
            releaseKey = setTimeout(async () => {
              try {
                if (!ending) await session.send({ event_type: 'user_action', action: 'key_up', input: command });
              } catch { stop(); }
              stepping = false;
            }, 420);
          }
        } catch { stop(); }
      });
    }
    const collect = async () => {
      for await (const event of session.receive()) {
        if (abort.signal.aborted) break;
        if (event.event_type === 'error') throw new Error(event.error?.message || 'Genie stream error.');
        if (event.event_type === 'interaction.completed') {
          log.terminal = 'completed';
          save();
          break;
        }
        const delta = event.delta;
        if (!delta?.data || !['video', 'image'].includes(delta.type)) continue;
        const bytes = Buffer.from(delta.data, 'base64');
        if (!log.frames) console.log('Video payload:', delta.mime_type, bytes.subarray(0, 12).toString('hex'));
        log.frames++;
        if (values.round && log.frames === 1) {
          moveWindow.start(Date.now());
          const durationMs = stagePilot ? stageDurationMs : 30000;
          publish({expiresAt: Date.now() + durationMs});
          const endChapter = () => {
            if (chapterNumber) publish({chapterExpired:true});
            finish(chapterNumber ? undefined : 'audience').catch(error => abort.abort(error));
          };
          gameClock = setTimeout(() => {
            const tail = Math.max(guard.tail(Date.now(),reactionTailMs),remainingReactionTail(lastStepFeedback, Date.now(), reactionTailMs));
            if (!tail) return endChapter();
            closingOnResponse = true;
            publish({reactionTailStarted:true});
            record('Waiting for the encounter response before the cut', {appliedFrame:lastStepFeedback?.appliedFrame, maximumMs:tail});
            gameClock = setTimeout(endChapter, tail);
          }, durationMs);
        }
        if ((values.drive || values.round) && process.connected && (stagePilot || (log.frames - 1) % 4 === 0)) {
          previewFrames.offer({frame:delta.data,frameNumber:log.frames});
        }
        writeFileSync(join(out, String(log.frames).padStart(5, '0') + '.frame'), bytes);
        if (stagePilot && !ending && guard.active) {
          await guard.advance(log.frames,Date.now(),async instruction=>{
            await session.send(instruction);
            steadyUntil=Math.max(steadyUntil,Date.now()+1500);
            moveWindow.settle(log.frames,Date.now(),1.5);
            encounter.acted();
            noteMotion();
            record('Directed defensive recovery',{frame:log.frames});
          });
        }
        if (stagePilot && !ending && (log.frames - 1) % 5 === 0) {
          follow.push(bytes, log.frames);
          await updateShot(log.frames);
        }
        if(stagePilot && !ending && !looking && Date.now()>=nextLook && log.frames>=1 &&
            (!reviewing || reviewableFrame(reviewing.appliedFrame,log.frames,log.fps))) {
          looking=true;
          const observed=log.frames, observedAt=Date.now();
          const stepForRead=reviewing;
          if (lastStepFeedback && Date.now()-lastStepFeedback.at>14000) lastStepFeedback=null;
          inspectRoom(ai,delta.data,abort.signal,playerReference,encounter.assessing || guard.active,lastStepFeedback,guard.basisImage).then(async scene=>{
            if(!ending){
              follow.observe(scene,observed);
              if (settlingChapter) {
                // Once the shoulder shot is in position, leave it still for the full vision read.
                // An unsuitable view can still use the normal camera recovery.
                holdChapterCamera = checkpointEligible(scene,!follow.verified(observed));
                if (holdChapterCamera && cameraPress) await releaseCamera();
              }
              const held = await updateShot(log.frames);
              const lock=follow.status();
              const current = lock.observed === observed;
              const tracked = follow.verified(observed);
              const reviewSubject = stepForRead && reviewing === stepForRead && sameReviewSubject(stepForRead.basisScene, scene);
              const guardReview=guard.observe(scene,observed);
              if (guardReview) record('Checked defensive pose',guardReview);
              const verifiedScene = tracked || reviewSubject || guardReview ? scene : {visible:false,playerCount:scene.playerCount,obstacles:[]};
              lastSight=tracked ? {observed,image:delta.data,scene} : null;
              const reviewed=finishReview(stepForRead,observed,verifiedScene.visible ? 'post-step pixels' : 'tracking lost');
              if (reviewed) await stopActor();
              const settled = placementView.ready(observed,follow.permitsPlacement(observed),moving());
              // The first purposeful step displacement establishes the new anchor.
              // A subsequent stationary frame can be used for the next command.
              const measurement=encounter.measure(verifiedScene, observed, reviewed ? verifiedScene.visible : settled);
              const trackingPlacementReady=!guard.active && !reviewed && measurement.stable;
              const drift=!reviewed && measurement.drift;
              if (!guard.active && !reviewed && !reviewing && !closingOnResponse && encounter.restoreFeet(verifiedScene)) {
                await releaseCamera();
                await session.send("Keep the existing explorer and obstacle standing on their current floorboards. Move only the observer back until both boots, the entire obstacle and the landing floor are visible together. Maintain the over-right-shoulder angle and fixed focal length, then lock the observation point.");
                noteMotion();
                publish({cameraMoved:true});
                record('Reframed to see both boots at the encounter', {observed});
              }
              if (drift && !guard.active) {
                // The provider can animate uncommanded travel. Do not inject or
                // verify from that moving view. Plant the feet and measure again.
                await stopActor(true);
                record('Held drifting explorer at encounter', {observed});
              }
              if (trackingPlacementReady) placementView.offered(Date.now());
              if (!held && current) recoveryRequested = false;
              if (held && current && !guard.active && !encounter.held && !recoveryRequested && (scene.playerCount > 1 || scene.visible && scene.playerMatch && scene.shoulderView === 'other')) {
                recoveryRequested = true;
                const instruction = scene.playerCount > 1
                  ? "Restore the original single-subject shot. Keep the existing closest orange backpack on the left, continuously in place. Clear the duplicate explorer farther down the hallway; the floor ahead belongs to the room and its obstacles."
                  : "Ease the observer back behind the right shoulder of the existing foreground explorer. Keep its backpack in the left third and the aisle visible past the right shoulder. Hold the figure and obstacles in place.";
                await session.send(instruction);
                record('Requested single-subject recovery',{observed,holdReason:lock.holdReason});
              }
              const checkpoint = chapterNumber && !guard.active && !reviewed && checkpointEligible(verifiedScene,held || !current)
                ? chapterSeed(delta.data) : null;
              publish({scene:verifiedScene,...(guardReview && {guardReview}),trackingSubjectVerified:tracked,proposedKey:proposedKey(scene),trackingReason:lock.holdReason,observed,observedAt,trackingNavigationHeld:guard.active || reviewed || held || !current,trackingPlacementReady,
                ...(checkpoint ? {checkpoint} : {})});
              record('Gemini observed live frame',{observed,observedAt,scene,tracking:{held:held || !current,reason:lock.holdReason,placementReady:trackingPlacementReady}});
            }
          }).catch(error=>{
            if (!ending) {
              publish({observationFailed:true});
              record('Observation unavailable', {observed, detail: error instanceof SyntaxError ? 'incomplete JSON' : error.name, elapsedMs: Date.now()-observedAt});
            }
          }).finally(()=>{looking=false;nextLook=Date.now()+450;});
        }
        if (pilot && !ending) await pilot(log.frames, delta.data);
        if (log.frames === 24 && trick) {
          await session.send(trick);
          record(ghost ? 'Ghost walk requested' : 'Painted door requested');
        }
        const move = moves.get(log.frames);
        if (move) {
          const [action, input] = move;
          await session.send({ event_type: 'user_action', action, input });
          record(`${action} ${input}`);
        }
        if (log.frames === endFrame) {
          await session.complete();
          record('Completion requested');
        }
      }
      if (!log.terminal) throw new Error('Connection ended without a completion acknowledgement.');
    };
    const deadline = new Promise((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
      abort.signal.throwIfAborted();
    });
    if (!autonomous) watchdog = setTimeout(stop, values.photo ? 50000 : 30000);
    await Promise.race([collect(), deadline]);
  } finally {
    ending = true;
    abort.abort();
    previewFrames.close();
    clearTimeout(gameClock);
    clearTimeout(releaseKey);
    clearTimeout(lookRelease);
    clearTimeout(actorStepTimer);
    clearTimeout(watchdog);
    try {
      if (session && !log.terminal) {
        await session.cancel();
        log.terminal = 'cancel-requested';
      } else if (interaction && !log.terminal) {
        const result = await ai.interactions.cancel(interaction.id, { api_version: 'v1beta' }, request);
        log.terminal = result.status;
      }
    } finally {
      session?.detach();
      process.removeListener('SIGINT', stop);
      process.off('message',stopDuringSetup);
      process.removeListener('SIGTERM', stop);
      process.removeListener('disconnect', stop);
      if ((values.drive || values.round) && process.connected) {
        process.send({ terminal: log.terminal || 'unconfirmed' });
        process.disconnect();
      }
      if(stagePilot && log.terminal) log.framing=assessFraming(log.events,log.frames);
      save();
      if (!interaction || ['completed', 'canceled', 'cancelled', 'failed'].includes(log.terminal)) {
        rmSync(lock, { recursive: true });
      }
      console.log('Session status:', log.terminal || 'unconfirmed', '| video payloads:', log.frames);
    }
  }
}

capture().catch(error => {
  console.error(String(error.message).replaceAll(process.env.GEMINI_API_KEY || '<unset>', '[redacted]'));
  process.exitCode = 1;
});
