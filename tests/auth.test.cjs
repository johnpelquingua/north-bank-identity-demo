const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({
  crypto: webcrypto,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  atob,
  btoa,
  document: undefined,
  location: { origin: 'http://localhost:8080', pathname: '/', href: 'http://localhost:8080/' },
  localStorage: { getItem: () => null },
  console,
});
// Initialize the browser code without a DOM. Its entrypoint stays disabled
// while these tests call the same security functions used by the app.
vm.runInContext(source.replace("const app=document.querySelector('#app');", 'const app=null;'), context);
const evaluate = expression => vm.runInContext(expression, context);

test('rejects unknown or misleading issuer and endpoint origins', () => {
  evaluate("config={issuer:'https://auth.pingone.com/test/as',clientId:'sample-client'}");
  assert.equal(evaluate('validateIssuer(config.issuer).href'), 'https://auth.pingone.com/test/as');
  for (const issuer of [
    'http://auth.pingone.com/test/as',
    'https://auth.pingone.com.evil.example/test/as',
    'https://auth.pingone.com/test/as/other',
    'https://auth.pingone.com/test/as?redirect=evil',
  ]) assert.throws(() => evaluate(`validateIssuer(${JSON.stringify(issuer)})`));
  assert.throws(() => evaluate("allowedEndpoint('https://evil.example/test/as/jwks')"));
});

test('accepts a valid ID token and rejects altered or invalid claims', async () => {
  const keys = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
  jwk.kid = 'test-key';
  context.getJSON = async () => ({ keys: [jwk] });
  evaluate("config={issuer:'https://auth.pingone.com/test/as',clientId:'sample-client'}");
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://auth.pingone.com/test/as', aud: 'sample-client', sub: 'ad-user-1', nonce: 'expected-nonce', iat: now, exp: now + 300 };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(payload) {
    const unsigned = encode({ alg: 'RS256', kid: 'test-key' }) + '.' + encode(payload);
    const signed = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, Buffer.from(unsigned));
    return unsigned + '.' + Buffer.from(signed).toString('base64url');
  }
  const validate = async value => context.validateIDToken(value, { jwks_uri: 'mock' }, { nonce: 'expected-nonce' });
  const good = await token(claims);
  assert.equal((await validate(good)).sub, 'ad-user-1');
  for (const changed of [
    { nonce: 'wrong' }, { aud: 'another-client' }, { iss: 'https://evil.example' },
    { azp: 'another-client' }, { exp: now - 1 }, { iat: now + 300 },
  ]) await assert.rejects(validate(await token({ ...claims, ...changed })));
  const tampered = good.split('.');
  tampered[1] = encode({ ...claims, sub: 'attacker' });
  await assert.rejects(validate(tampered.join('.')), /signature/);
});

test('CSV export protects text fields and keeps negative amounts numeric', () => {
  const result = context.csvRows([{ name: '=SUM(1,1)', detail: '@attacker', date: '12 Oct 2026', amount: -25.5 }]);
  assert.match(result, /"'=SUM\(1,1\)"/);
  assert.match(result, /"'@attacker"/);
  assert.match(result, /,-25\.50$/);
});

test('profile shows the phone claim returned for a signed-in user', () => {
  evaluate("session={mode:'pingone',user:{sub:'ad-user-1',phone_number:'+63 917 123 4567'}}");
  const html = evaluate('profile()');
  assert.match(html, /Telephone number/);
  assert.match(html, /value="\+63 917 123 4567" readonly/);
  evaluate('session=null');
});

test('opening the main page starts a non-redirect PingOne flow with PKCE', async () => {
  let request;
  let receivedFlow;
  const flow = { id: '0370bd50-0f2a-4749-afd4-195a63553372' };
  context.document = { querySelector: () => ({ textContent: '' }) };
  context.sessionStorage = { setItem: (key, value) => { context.pending = { key, value }; } };
  context.discovery = async () => ({ authorization_endpoint: 'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as/authorize' });
  context.getJSON = async (url, options) => { request = { url, options }; return flow; };
  context.beginFlow = value => { receivedFlow = value; };
  await context.startLogin();
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('response_mode'), 'pi.flow');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('prompt'), 'login');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid profile email phone');
  assert.equal(request.options.credentials, 'include');
  assert.equal(receivedFlow, flow);
  assert.equal(JSON.parse(context.pending.value).mode, 'flow');
});
