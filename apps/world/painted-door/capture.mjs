import { createNativeFollow, characterInstruction, reactionInstruction, holdIfUntracked, receding, createMoveWindow, shoulderStride } from './native-follow.mjs';
import { assessFraming } from './framing-report.mjs';
import { hallwayLighting } from '../rehearsal/look.mjs';
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
    "One continuous third-person shoulder shot. The camera is attached to a short steady boom behind and just RIGHT of the same little robot’s right shoulder, looking forward down the room, within fifteen degrees of its heading. Our eye is just above the head, tilted slightly down onto the next patch of floor. As the robot moves the observer travels with it at the same speed, fixed distance and focal length.",
    "Keep the near back of its head, sage right shoulder, orange twin-strap backpack and brass flashlight prominent in the LEFT third. The visible silhouette occupies 35 to 40 percent of screen width. Its head starts around 29 percent down. Thighs meet the bottom edge with both boots below the picture. Keep this foreground composition as the hall moves past. The open route and obstacles are visible just beyond the right shoulder across the middle and right.",
    "The robot lifts its flashlight to look down the actual photographed aisle and pauses for its next instruction. Long connected bays, familiar lamps and flooring continue toward a distant illuminated exit near center-right. Keep the next few unobstructed steps on-screen; the robot can halt, turn, or move around a visible encounter."
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
  const log = { episodeId: process.env.PG_WORLD_EPISODE_ID, seed: values.photo ? basename(values.photo) : seed, proposal: trick, fps: 24, frames: 0, events: [], terminal: null };
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
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  if (values.drive || values.round) process.once('disconnect', stop);
  let gameClock, looking=false, nextLook=0;
  const follow = stagePilot ? createNativeFollow() : null;
  const moveWindow = createMoveWindow(log.fps);
  let cameraPress=null, lookRelease, steadyUntil=0, actorMoving=false, placedHoldUntil=0;
  async function releaseCamera() {
    const press=cameraPress;
    if(!press) return;
    if(!press.release) {
      clearTimeout(lookRelease);
      press.release=(async()=>{
        try{
          await press.down;
          if(!ending) for(const key of press.keys) await session.send({event_type:'user_action',action:'key_up',input:key});
        } finally { if(cameraPress===press) cameraPress=null; }
      })();
    }
    await press.release;
  }
  async function aim(step,frame) {
    if(ending || cameraPress || Date.now()<steadyUntil) return;
    const press={keys:[step.key,step.lateralKey].filter(Boolean), stride:step.reason==='match forward stride'};
    cameraPress=press;
    press.down=(async()=>{for(const key of press.keys) await session.send({event_type:'user_action',action:'key_down',input:key});})();
    await press.down;
    publish({cameraMoved:true});
    record('Camera reframed the robot',{...step,frame});
    if(!press.release && !ending) lookRelease=setTimeout(()=>releaseCamera().catch(error=>abort.abort(error)),step.ms);
  }
  function unsafeForwardPress(subject) {
    if (!cameraPress?.keys.includes('key_w')) return false;
    return cameraPress.stride ? !shoulderStride(subject) : !receding(subject);
  }
  async function stopActor(force=false) {
    if(!actorMoving && !force) return;
    actorMoving=false;
    await session.send("The robot stops its current step now, plants both boots, and waits in place. Its flashlight stays lit.");
    record('Paused robot travel');
  }
  if (autonomous) watchdog = setTimeout(stop, stagePilot ? Number(process.env.PG_REHEARSAL_LIVE_MS || 45000) + 35000 : values.round ? 60000 : 45000);
  try {
    interaction = await ai.interactions.create({ model: 'genie-4', api_version: 'v1beta' }, request);
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
      if (winner) {
        log.winner = winner;
        record(winner === 'robot' ? 'Robot reached the exit' : 'Audience wins on time');
        publish({winner});
      }
      await session.complete();
    };
    const pilot = autonomous && !stagePilot && cameraPilot({ ai, model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview', send: event => ending ? Promise.resolve() : session.send(event), record, finish, fail: error => abort.abort(error), signal: abort.signal, chairTest: values['chair-test'], gameRound: values.round, isActive: () => !ending });
    if (values.round) process.on('message', async command => {
      if (ending) return;
      try {
        if (stagePilot && command?.haunt) {
          const haunt = command.haunt;
          const [y, x] = haunt.target || [];
          const location = Number.isFinite(y) && Number.isFinite(x)
            ? `The robot's planned next footfall is at ${Math.round(x/10)} percent across and ${Math.round(y/10)} percent down this view.`
            : "Place it across the walking line joining the robot’s boots and the next stretch of walkable floor.";
          const instruction = [haunt.text, location, haunt.hint || "The effect crosses the lane one or two strides in front of the boots. The robot must stop or go around it.",
            /chair/i.test(haunt.text) ? "One bright yellow tipped-over chair spans that path." : "",
            "Keep the effect, its contact with the floor, and the approaching robot in view."].filter(Boolean).join(" ");
          try {
            moveWindow.settle(log.frames, Date.now(), .5);
            await session.send(instruction);
            publish({injected:haunt.id, attempt:haunt.attempt, injectedAt:Date.now(), injectedFrame:log.frames});
            record('Audience intervention sent',{id:haunt.id,attempt:haunt.attempt,text:haunt.text,target:haunt.target});
          } catch (error) {
            publish({injectionFailed:haunt.id, attempt:haunt.attempt});
            throw error;
          }
        } else if (stagePilot && command?.pause) {
          const now=Date.now();
          const force=command.settleCamera && now>=placedHoldUntil;
          steadyUntil=now+2700;
          moveWindow.settle(log.frames, now, .5);
          if(command.settleCamera) placedHoldUntil=steadyUntil;
          await Promise.all([releaseCamera(),stopActor(force)]);
          record(command.settleCamera ? 'Held the camera for placement' : 'Paused at the encounter');
        } else if(stagePilot && !command?.key && command?.reaction) {
          const instruction=reactionInstruction(command);
          if(!instruction || !follow.permits('W')) return;
          moveWindow.settle(log.frames, Date.now(), 1);
          await releaseCamera();
          await stopActor();
          await session.send(instruction);
          record('Requested robot reaction',{reaction:command.reaction,toward:command.toward});
        } else if(stagePilot && command?.key) {
          if(Date.now()<steadyUntil || !follow.permits(command.key)) return;
          const instruction=characterInstruction(command);
          if(!instruction) return;
          const subject = follow.status();
          if (!moveWindow.accept(command, subject, log.frames, Date.now())) {
            record('Waiting for post-action footage', {key:command.key, observed:command.observed});
            return;
          }
          const stride = command.key === 'W' ? shoulderStride(subject) : null;
          if (cameraPress && (stride || cameraPress.keys.includes('key_w'))) {
            await releaseCamera();
            if (ending || Date.now() < steadyUntil || !follow.permits(command.key) ||
                follow.status().observed !== command.observed) return;
          }
          actorMoving=['W','A','S','D'].includes(command.key);
          await Promise.all([session.send(instruction), stride && aim(stride, log.frames)]);
          publish({navigationMoved:true,key:command.key,observed:command.observed});
          record('Player applied '+command.key,{observed:command.observed,holdMs:command.ms,reaction:command.reaction,transport:'world action',frame:log.frames});
        } else if (stagePilot && command?.winner) await finish(command.winner);
        else if (command === 'end') await finish();
        else if (command === 'chair' || command === 'peel') {
          const object = command === 'chair' ? 'One bright yellow cafe chair stands sideways' : 'A yellow banana peel lies flat';
          await session.send(object + ' in the flashlight beam on the open floor three or four robot strides ahead. It stays still and leaves a visible route to the right. Keep the same robot and camera.');
          record(command === 'chair' ? 'Audience requested a chair' : 'Audience requested a peel');
        }
      } catch (error) { abort.abort(error); }
    });
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
          const durationMs = stagePilot ? Number(process.env.PG_REHEARSAL_LIVE_MS || 45000) : 30000;
          publish({expiresAt: Date.now() + durationMs});
          gameClock = setTimeout(() => { finish('audience').catch(error => abort.abort(error)); }, durationMs);
        }
        if ((values.drive || values.round) && process.connected && (log.frames - 1) % (stagePilot ? 2 : 4) === 0) {
          process.send({ frame: delta.data }, error => { if (error) stop(); });
        }
        writeFileSync(join(out, String(log.frames).padStart(5, '0') + '.frame'), bytes);
        if (stagePilot && !ending && (log.frames - 1) % 5 === 0) {
          follow.push(bytes, log.frames);
          const lock = follow.status();
          if(unsafeForwardPress(lock)) await releaseCamera();
          if(!await holdIfUntracked(lock,releaseCamera,stopActor) && !cameraPress && Date.now()>=steadyUntil){
            const step=follow.correction(Date.now());
            if(step) await aim(step,log.frames);
          }
        }
        if(stagePilot && !ending && !looking && Date.now()>=nextLook && log.frames>=1) {
          looking=true;
          const observed=log.frames, observedAt=Date.now();
          inspectRoom(ai,delta.data,abort.signal).then(async scene=>{
            if(!ending){
              follow.observe(scene,observed);
              const lock=follow.status();
              if(unsafeForwardPress(lock)) await releaseCamera();
              const held = await holdIfUntracked(lock,releaseCamera,stopActor);
              const currentScene = !held && lock.observed === observed ? scene : { visible:false, obstacles:[] };
              publish({scene:currentScene,observed,observedAt});
              record('Gemini observed live frame',{observed,observedAt,scene});
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
    clearTimeout(gameClock);
    clearTimeout(releaseKey);
    clearTimeout(lookRelease);
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
