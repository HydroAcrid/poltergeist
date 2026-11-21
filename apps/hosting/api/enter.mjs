import { Sandbox } from '@vercel/sandbox';
import { prepareColdHostLease } from '../world-lease.mjs';

const views = new Set(['haunt', 'stage', 'team', 'debug']);
const pause = ms => new Promise(done => setTimeout(done, ms));

async function serving(origin) {
  try {
    const response = await fetch(origin + '/rehearsal/lobby', {
      cache: 'no-store', signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) return false;
    return typeof (await response.json()).phase === 'string';
  } catch {
    return false;
  }
}

async function startWorld(box, origin) {
  if (!process.env.GEMINI_API_KEY || !process.env.PG_HOST_TOKEN) throw Error('World credentials unavailable');
  // The lock covers the server lifetime, including two simultaneous guest arrivals.
  await box.runCommand({
    cmd: 'flock', args: ['-n', '/tmp/poltergeist-world.lock', 'node', 'apps/world/rehearsal/run.mjs', '--genie'],
    cwd: '/vercel/sandbox/app', detached: true,
    env: {
      PG_BIND_HOST: '0.0.0.0', PORT: '3000', PG_PUBLIC_URL: origin,
      PG_WORLD_LEASE_END_MS: String(await prepareColdHostLease(box.currentSession())),
      PG_JOIN_URL: 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL,
      ...(process.env.PG_REHEARSAL_LIVE_MS ? {PG_REHEARSAL_LIVE_MS: process.env.PG_REHEARSAL_LIVE_MS} : {}),
      PG_VENUE_PHOTO: '/vercel/sandbox/plate.jpg',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY, PG_HOST_TOKEN: process.env.PG_HOST_TOKEN,
    },
  });
  for (let i = 0; i < 18; i++) {
    if (await serving(origin)) return;
    await pause(350);
  }
  throw Error('World startup timed out');
}

export default async function enter(req, res) {
  const view = new URL(req.url, 'https://localhost').searchParams.get('view') || 'haunt';
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD'].includes(req.method) || !views.has(view)) return res.status(404).end();
  try {
    const box = await Sandbox.get({name: 'poltergeist-world', resume: true});
    const origin = box.domain(3000);
    if (!(await serving(origin))) await startWorld(box, origin);
    return res.redirect(307, origin + '/' + view);
  } catch (error) {
    console.error('World unavailable:', error.name);
    res.setHeader('Retry-After', '5');
    return res.status(503).send('The hallway is opening. Refresh this page in a moment.');
  }
}
