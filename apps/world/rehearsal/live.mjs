import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function openLive({ dir, seed, episodeId, onMessage, onClose }) {
  if (!dir) throw Error('The local Genie broker is unavailable.');
  const capture = resolve(dir, 'capture.mjs'),
    envPath = process.env.PG_WORLD_ENV_FILE || resolve(dir, '../../../.env');
  if (!existsSync(capture) || !existsSync(envPath))
    throw Error('The World broker is unavailable.');
  const work = mkdtempSync(join(tmpdir(), 'poltergeist-seed-')),
    file = join(work, 'hallway.jpg');
  writeFileSync(file, seed, { mode: 0o600 });
  const child = fork(
    capture,
    ['--live', '--round', '--stage-pilot', '--photo', file],
    {
      cwd: dir,
      env: { ...process.env, PG_WORLD_EPISODE_ID: episodeId },
      execArgv: ['--env-file=' + envPath],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  let terminal = null,
    errored = false;
  child.on('error', () => {
    errored = true;
  });
  child.on('message', (m) => {
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
      if (child.connected) child.send('end', () => {});
    },
  };
}
