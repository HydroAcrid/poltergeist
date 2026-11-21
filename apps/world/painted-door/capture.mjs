import { GoogleGenAI } from '@google/genai';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

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
    'ghost-walk': { type: 'boolean' }, 'two-moves': { type: 'boolean' }, 'chair-test': { type: 'boolean' }, round: { type: 'boolean' }, drive: { type: 'boolean' },
  } });
  if (values.drive && (!process.send || !values.photo || values.haunt || values['ghost-walk'])) {
    throw new Error('Start manual driving from the local operator page.');
  }
  const autonomous = values['two-moves'] || values['chair-test'] || values.round;
  if (values.round) {
    if (values['two-moves'] || values['chair-test'] || values.photo) throw new Error('A game round uses its fixed hallway seed.');
    values.photo = '../robot-v1/hallway-seed.jpg';
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
  const log = { seed: values.photo ? basename(values.photo) : seed, proposal: trick, fps: 24, frames: 0, events: [], terminal: null };
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
  let gameClock;
  if (autonomous) watchdog = setTimeout(stop, values.round ? 60000 : 45000);
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
    const pilot = autonomous && cameraPilot({ ai, model: process.env.PG_MODEL_PERCEPTION || 'gemini-robotics-er-2-preview', send: event => ending ? Promise.resolve() : session.send(event), record, finish, fail: error => abort.abort(error), signal: abort.signal, chairTest: values['chair-test'], gameRound: values.round, isActive: () => !ending });
    if (values.round) process.on('message', async command => {
      if (ending) return;
      try {
        if (command === 'end') await finish();
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
          const durationMs = 30000;
          publish({expiresAt: Date.now() + durationMs});
          gameClock = setTimeout(() => { finish('audience').catch(error => abort.abort(error)); }, durationMs);
        }
        if ((values.drive || values.round) && process.connected && (log.frames - 1) % 4 === 0) {
          process.send({ frame: delta.data }, error => { if (error) stop(); });
        }
        writeFileSync(join(out, String(log.frames).padStart(5, '0') + '.frame'), bytes);
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
