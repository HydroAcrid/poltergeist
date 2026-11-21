import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function openLive({ dir, seed, episodeId, playMode, plannedDurationMs, chapter, chapterMs, reactionTailMs = 0, onMessage, onClose }) {
  if (!dir) throw Error('The local Genie broker is unavailable.');
  const capture = resolve(dir, 'capture.mjs'),
    envPath = process.env.PG_WORLD_ENV_FILE || resolve(dir, '../../../.env');
  if (!existsSync(capture) || (!process.env.GEMINI_API_KEY && !existsSync(envPath)))
    throw Error('The World broker is unavailable.');
  const work = mkdtempSync(join(tmpdir(), 'poltergeist-seed-')),
    file = join(work, 'hallway.jpg');
  writeFileSync(file, seed, { mode: 0o600 });
  const child = fork(
    capture,
    ['--live', '--round', '--stage-pilot', '--photo', file],
    {
      cwd: dir,
      env: { ...process.env, PG_WORLD_EPISODE_ID: episodeId, PG_WORLD_CHAPTER:String(chapter || 0),
        PG_WORLD_PLAY_MODE: playMode, PG_WORLD_PLANNED_DURATION_MS: String(plannedDurationMs),
        PG_WORLD_REACTION_TAIL_MS: String(reactionTailMs),
        ...(chapter ? {PG_REHEARSAL_LIVE_MS:String(chapterMs)} : {}) },
      execArgv: existsSync(envPath) ? ['--env-file=' + envPath] : [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  let stopRequested=false;
  let terminal = null,
    errored = false;
  child.on('error', () => {
    errored = true;
  });
  child.on('message', (m) => {
    if (m.controlsReady && stopRequested && child.connected) child.send('end',()=>{});
    if (m.terminal) terminal = m.terminal;
    onMessage(m);
  });
  child.once('close', () => {
    rmSync(work, { recursive: true, force: true });
    onClose(errored ? 'failed' : terminal);
  });
  return {
    send(command) {
      if (child.connected) child.send(command, () => {});
    },
    stop() {
      stopRequested=true;
      if (child.connected) child.send('end', () => {});
    },
  };
}
