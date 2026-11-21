const { test } = require('node:test');
const assert = require('node:assert/strict');

async function gate() {
  const {registerHostAccess} = await import('../apps/world/rehearsal/host-access.mjs');
  let hook, login;
  registerHostAccess({
    addHook(_name, fn) { hook = fn; },
    addContentTypeParser() {},
    post(_path, fn) { login = fn; },
  }, {token: 'test-host-passphrase', publicOrigin: 'https://demo.example'});
  async function request(method, url, headers = {}, body) {
    const req = {method, headers, body, routeOptions: {url}};
    const response = {status:200, headers: {},
      code(n) { this.status=n; return this; }, type(s) { return this.header('content-type',s); },
      header(k,v) { this.headers[k]=v; return this; },
      send(result) { this.body=result; return this; },
    };
    const ended = await hook(req, response);
    if (!ended && url === '/host/login') await login(req, response);
    return response;
  }
  return request;
}

test('public World listeners require a host passphrase and an HTTPS origin', async () => {
  const {hostSettings} = await import('../apps/world/rehearsal/host-access.mjs');
  assert.equal(hostSettings({}).host, '127.0.0.1');
  assert.throws(() => hostSettings({PG_BIND_HOST:'0.0.0.0'}), /PG_HOST_TOKEN/);
  assert.throws(() => hostSettings({PG_BIND_HOST:'0.0.0.0', PG_HOST_TOKEN:'example'}), /HTTPS/);
  assert.equal(hostSettings({PG_BIND_HOST:'0.0.0.0', PG_HOST_TOKEN:'example', PG_PUBLIC_URL:'https://demo.example/'}).publicOrigin, 'https://demo.example');
});

test('host sign-in stays private and unlocks only the trusted browser session', async () => {
  const req = await gate();
  for (const path of ['/', '/haunt', '/stage']) assert.equal((await req('GET',path)).status, 200);
  for (const path of ['/team','/debug']) {
    const r=await req('GET',path); assert.equal(r.status,401); assert.match(r.body,/Host sign-in/);
  }
  const button={'x-show-control':'1', origin:'https://demo.example'};
  for (const path of ['/rehearsal/photo','/rehearsal/start','/api/brain/tick'])
    assert.equal((await req('POST',path,button)).status,401);
  assert.equal((await req('POST','/host/login',button,{token:'incorrect'})).status,401);
  const r=await req('POST','/host/login',button,{token:'test-host-passphrase',next:'/debug'});
  assert.equal(r.status,303); assert.equal(r.headers.location,'/debug');
  assert.match(r.headers['set-cookie'],/HttpOnly; SameSite=Strict; Secure/);
  assert.doesNotMatch(r.headers['set-cookie'],/test-host-passphrase/);
  const cookie=r.headers['set-cookie'].split(';')[0];
  assert.equal((await req('GET','/debug',{cookie})).status,200);
  assert.equal((await req('POST','/rehearsal/photo',{...button,cookie})).status,200);
  assert.equal((await req('POST','/rehearsal/photo',{...button,cookie,origin:'https://other.example'})).status,403);
  assert.equal((await req('POST','/api/brain/tick',{authorization:'Bearer test-host-passphrase'})).status,200);
});
