import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vite = resolve(root, 'apps/crowd/node_modules/vite-node/vite-node.mjs');
if (
  !existsSync(vite) ||
  !existsSync(resolve(root, 'apps/brain/node_modules/yaml/package.json'))
) {
  console.error(
    'Install the rehearsal packages first with npm run rehearsal:setup.',
  );
  process.exit(1);
}
const paidHost = process.argv.includes('--genie');
process.env.PG_ALLOW_GENIE = paidHost ? '1' : '0';
if (paidHost) {
  const capture =
    process.env.PG_CAPTURE_DIR || resolve(root, 'apps/world/painted-door');
  const envFile = process.env.PG_WORLD_ENV_FILE || resolve(capture, '../../../.env');
  if (
    !existsSync(resolve(capture, 'node_modules/@google/genai/package.json')) ||
    !existsSync(envFile)
  ) {
    console.error(
      'The World host needs its local .env and capture dependencies. See apps/world/rehearsal/README.md.',
    );
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  process.env.PG_CAPTURE_DIR = capture;
} else {
  process.env.PG_MODERATION_ADAPTER = 'rules-only';
}
process.chdir(root);
process.argv = [
  process.execPath,
  vite,
  '--config',
  'apps/crowd/dev/rehearsal.config.mjs',
  'apps/world/rehearsal/lane-host.ts',
];
await import(pathToFileURL(vite));
