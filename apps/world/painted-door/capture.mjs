import { GoogleGenAI } from '@google/genai';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const seed = 'First-person eye-level view inside a bright old cinema lobby. A wide cream plaster wall faces the camera square on, three metres away. The left half of this wall is completely bare. On the far right is one real dark green door with a deep jamb. Burgundy carpet, brass sconces, warm light. Camera still. No people.';
const proposal = 'Paint a life-size red exit door directly onto the blank left half of the wall. Its frame, handle and shadows are flat brushstrokes on the plaster. Keep the real green door on the right unchanged.';

async function capture() {
  if (process.env.PG_ALLOW_GENIE !== '1' || !process.argv.includes('--live')) {
    throw new Error('To start one paid Genie session, set PG_ALLOW_GENIE=1 and pass --live.');
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY.');
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
  const out = mkdtempSync('runs/painted-door-');
  const log = { seed, proposal, fps: 24, frames: 0, events: [], terminal: null };
  const save = () => writeFileSync(join(out, 'session.json'), JSON.stringify(log, null, 2));
  const record = (action) => {
    log.events.push({ frame: log.frames, action });
    save();
    console.log('Frame', log.frames, action);
  };

  let interaction;
  let session;
  let watchdog;
  const abort = new AbortController();
  const stop = () => abort.abort(new Error('Capture stopped.'));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    interaction = await ai.interactions.create({ model: 'genie-4', api_version: 'v1beta' }, request);
    log.interactionId = interaction.id;
    save();
    console.log('Recording in', out);
    session = await ai.interactions.connect(interaction.id, { transport: 'websocket', api_version: 'v1beta' }, request);
    await session.send({ event_type: 'world_setup', world_prompt: { text: seed } });
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
        writeFileSync(join(out, String(log.frames).padStart(5, '0') + '.frame'), bytes);
        switch (log.frames) {
          case 24:
            await session.send(proposal);
            record('Painted door requested');
            break;
          case 144:
          case 168: {
            const down = log.frames === 144;
            await session.send({ event_type: 'user_action', action: down ? 'key_down' : 'key_up', input: 'key_d' });
            record(down ? 'Strafe right' : 'Release right');
            break;
          }
          case 216:
            await session.complete();
            record('Completion requested');
            break;
        }
      }
      if (!log.terminal) throw new Error('Connection ended without a completion acknowledgement.');
    };
    const deadline = new Promise((_, reject) => {
      abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
      abort.signal.throwIfAborted();
    });
    watchdog = setTimeout(stop, 30000);
    await Promise.race([collect(), deadline]);
  } finally {
    clearTimeout(watchdog);
    try {
      if (interaction && !log.terminal) {
        const result = await ai.interactions.cancel(interaction.id, { api_version: 'v1beta' }, request);
        log.terminal = result.status;
      }
    } finally {
      session?.detach();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
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
