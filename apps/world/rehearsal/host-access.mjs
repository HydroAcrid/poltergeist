import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const cookieName = 'pg_host_session';
const digest = text => createHash('sha256').update(text).digest();

export function hostSettings(env) {
  const host = env.PG_BIND_HOST || '127.0.0.1';
  const token = env.PG_HOST_TOKEN || '';
  const publicOrigin = env.PG_PUBLIC_URL ? new URL(env.PG_PUBLIC_URL).origin : '';
  if (!loopback.has(host)) {
    if (!token) throw Error('Set PG_HOST_TOKEN before exposing the World host.');
    if (!publicOrigin.startsWith('https://'))
      throw Error('Set PG_PUBLIC_URL to the public HTTPS demo origin.');
  }
  return { host, token, publicOrigin };
}

function sameOrigin(req, publicOrigin) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === publicOrigin && publicOrigin) return true;
  try {
    const url = new URL(origin);
    return loopback.has(url.hostname) && url.host === req.headers.host &&
      (url.protocol === 'http:' || url.protocol === 'https:') && origin === url.origin;
  } catch {
    return false;
  }
}

function passphraseForm(next, rejected = false) {
  const page = next === '/debug' ? '/debug' : '/team';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Poltergeist · Host sign-in</title><style>html{color-scheme:dark;font:17px/1.5 system-ui;background:#0c110f;color:#f8f5e8}main{max-width:25rem;margin:16vh auto;padding:1.5rem}h1{font:2.4rem Georgia}label,input,button{display:block}input,button{font:inherit;margin:.5rem 0 1rem;padding:.7rem;width:100%;box-sizing:border-box}button{cursor:pointer}a{color:#e9e9a8}</style>
<main><h1>Host sign-in</h1><form action="/host/login" method="post"><input type="hidden" name="next" value="${page}"><label for="token">Host passphrase</label><input type="password" id="token" name="token" required autocomplete="current-password">${rejected ? '<p role="alert">That passphrase didn’t work. Try again.</p>' : ''}<button>Open host controls</button></form><a href="/haunt">Join the audience</a></main></html>`;
}

export function registerHostAccess(app, { token, publicOrigin }) {
  const tokenDigest = digest(token);
  const session = randomBytes(32).toString('base64url');
  const sessionDigest = digest(session);
  const secure = publicOrigin.startsWith('https://') ? '; Secure' : '';

  function authenticated(req) {
    const authorization = req.headers.authorization || '';
    if (authorization.startsWith('Bearer ') && timingSafeEqual(digest(authorization.slice(7)), tokenDigest))
      return true;
    const value = /(?:^|;\s*)pg_host_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    return Boolean(value && timingSafeEqual(digest(value), sessionDigest));
  }
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions.url || '';
    if (req.method === 'POST' && !sameOrigin(req, publicOrigin))
      return reply.code(403).send({ error: 'Origin mismatch' });
    const page = route === '/team' || route === '/debug';
    const control = req.method === 'POST' && (route.startsWith('/rehearsal/') || route === '/api/brain/tick');
    if (!token || !(page || control)) return;
    reply.header('cache-control', 'private, no-store').header('vary', 'Cookie, Authorization');
    if (authenticated(req)) return;
    if (page) return reply.code(401).type('text/html; charset=utf-8').send(passphraseForm(route));
    return reply.code(401).send({ error: 'Host sign-in required.' });
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));
  app.post('/host/login', async (req, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (!token || typeof req.body?.token !== 'string' || !timingSafeEqual(digest(req.body.token), tokenDigest))
      return reply.code(401).type('text/html; charset=utf-8').send(passphraseForm(req.body?.next, true));
    const destination = req.body.next === '/debug' ? '/debug' : '/team';
    return reply.header('set-cookie', cookieName + '=' + session + '; Path=/; HttpOnly; SameSite=Strict' + secure)
      .code(303).header('location', destination).send();
  });
}
