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

test('profile formats and escapes the OIDC address claim', () => {
  evaluate("session={mode:'pingone',user:{sub:'ad-user-1',address:{street_address:'12 Main <Street>',locality:'Manila',region:'Metro Manila',postal_code:'1000',country:'PH'}}}");
  const html = evaluate('profile()');
  assert.match(html, /Address<\/label>/);
  assert.match(html, /value="12 Main &lt;Street&gt;, Manila, Metro Manila, 1000, PH" readonly/);
  assert.equal(evaluate("formatAddress({formatted:'Line 1\\nManila'})"), 'Line 1, Manila');
  evaluate('session=null');
});

test('MFA device requests stay in the configured PingOne environment', async () => {
  const userId = 'fa15fe35-b52a-4240-a22f-59274a2fa72a';
  evaluate("config={issuer:'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as',clientId:'sample-client'}");
  assert.equal(evaluate(`mfaDeviceUrl('${userId}')`),
    `https://api.pingone.sg/v1/environments/22f37616-5cf6-47ee-8111-f0c870cbfa8f/users/${userId}/devices`);
  assert.throws(() => evaluate("mfaDeviceUrl('../another-user')"), /Invalid MFA device request/);
  evaluate(`session={mode:'pingone',user:{sub:'${userId}'},accessToken:'test-token',mfaReady:false}`);
  context.mfaApi = async () => ({ _embedded: { devices: [{ type: 'TOTP', status: 'ACTIVATION_REQUIRED' }] } });
  await context.loadMfaState();
  assert.equal(evaluate('session.mfaReady'), false);
  context.mfaApi = async () => ({ _embedded: { devices: [{ type: 'TOTP', status: 'ACTIVE' }] } });
  await context.loadMfaState();
  assert.equal(evaluate('session.mfaReady'), true);
  context.mfaApi = async () => ({ _embedded: { devices: [{ type: 'FIDO2', status: 'ACTIVE' }] } });
  await context.loadMfaState();
  assert.equal(evaluate('session.mfaReady'), true);
  evaluate('session=null');
});

test('profile opens MFA management and preference changes use PingOne device order', async () => {
  const userId = 'fa15fe35-b52a-4240-a22f-59274a2fa72a';
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  evaluate(`session={mode:'pingone',user:{sub:'${userId}',email:'user@example.com'},accessToken:'test-token',mfaReady:true}`);
  assert.match(evaluate('profile()'), /Manage sign-in methods/);
  const devices = [{ id: first, type: 'TOTP', status: 'ACTIVE', nickname: '<unsafe>' }, { id: second, type: 'FIDO2', status: 'ACTIVE' }];
  let reorder;
  context.mfaApi = async (url, options) => {
    if (options) { reorder = { url, options }; return {}; }
    return { order: [{ id: first }, { id: second }], _embedded: { devices } };
  };
  context.render = () => {};
  context.toast = () => {};
  context.document = { querySelectorAll: () => [] };
  await context.loadMfaState();
  const html = evaluate('mfaPage()');
  assert.match(html, /Preferred/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.doesNotMatch(html, /data-add-mfa="TOTP"/);
  assert.doesNotMatch(html, /data-add-mfa="FIDO2"/);
  assert.match(html, /data-add-mfa="EMAIL"/);
  await context.preferMfaDevice(second);
  assert.equal(reorder.url, `https://api.pingone.sg/v1/environments/22f37616-5cf6-47ee-8111-f0c870cbfa8f/users/${userId}/devices`);
  assert.equal(reorder.options.headers['Content-Type'], 'application/vnd.pingidentity.devices.reorder+json');
  assert.deepEqual(JSON.parse(reorder.options.body), { order: [{ id: second }, { id: first }] });
  context.document = undefined;
  evaluate('session=null');
});

test('MFA add section hides every method already enrolled', () => {
  evaluate(`session={mode:'pingone',user:{sub:'fa15fe35-b52a-4240-a22f-59274a2fa72a',email:'user@example.com'},mfaReady:true,mfaDevices:[{id:'11111111-1111-4111-8111-111111111111',type:'TOTP',status:'ACTIVE'},{id:'22222222-2222-4222-8222-222222222222',type:'FIDO2',status:'ACTIVE'},{id:'33333333-3333-4333-8333-333333333333',type:'EMAIL',status:'ACTIVE'}],mfaOrder:[]}`);
  const html = evaluate('mfaPage()');
  assert.match(html, /All available methods are already enrolled/);
  assert.doesNotMatch(html, /data-add-mfa=/);
  evaluate('session=null');
});

test('email enrollment accepts a method PingOne activates immediately', async () => {
  const userId = 'fa15fe35-b52a-4240-a22f-59274a2fa72a';
  evaluate(`session={mode:'pingone',user:{sub:'${userId}',email:'user@example.com'},accessToken:'test-token',mfaReady:true}`);
  context.document = { querySelector: () => ({ disabled: false }) };
  let request;
  context.mfaApi = async (url, options) => { request = options; return { id: '11111111-1111-4111-8111-111111111111', status: 'ACTIVE' }; };
  let completed = false;
  context.finishMfaEnrollment = async () => { completed = true; };
  await context.createEmailAuthenticator();
  assert.equal(completed, true);
  assert.deepEqual(JSON.parse(request.body), { type: 'EMAIL', email: 'user@example.com' });
  context.document = undefined;
  evaluate('session=null');
});

test('profile enrollment stays in the app while first enrollment uses the sign-in layout', () => {
  const main = { innerHTML: '' };
  const isolated = vm.createContext({
    URL, URLSearchParams, atob, btoa, localStorage: { getItem: () => null },
    location: { href: 'https://example.com/', origin: 'https://example.com', hostname: 'example.com' },
    document: { querySelector: selector => selector === '#main' ? main : null },
  });
  const noEntrypoint = source.slice(0, source.indexOf("if(typeof document!=='undefined'){const query="));
  vm.runInContext(noEntrypoint.replace("const app=document.querySelector('#app');", "const app={innerHTML:'BANKING_SHELL'};"), isolated);
  vm.runInContext("session={mode:'pingone',user:{email:'user@example.com'},mfaReady:true,mfaDevices:[{type:'TOTP',status:'ACTIVE'}]};mfaEnrollmentOpen=true;renderEnrollment()", isolated);
  assert.match(main.innerHTML, /Add a sign-in method/);
  assert.doesNotMatch(main.innerHTML, /id="mfa-start"/);
  assert.equal(vm.runInContext('app.innerHTML', isolated), 'BANKING_SHELL');
  vm.runInContext('mfaEnrollmentOpen=false;renderEnrollment()', isolated);
  assert.match(vm.runInContext('app.innerHTML', isolated), /class="login"/);
});

test('FIDO2 enrollment uses the environment policy and this site as the relying party', async () => {
  const userId = 'fa15fe35-b52a-4240-a22f-59274a2fa72a';
  evaluate(`session={mode:'pingone',user:{sub:'${userId}'},accessToken:'test-token',mfaReady:true}`);
  context.document = { querySelector: () => ({ disabled: false }) };
  context.location.hostname = 'johnpelquingua.github.io';
  context.navigator = { credentials: { create: async () => ({ id: 'credential' }) } };
  context.window = { isSecureContext: true };
  const originalFidoOptions = context.fidoOptions;
  const originalFidoAttestation = context.fidoAttestation;
  context.fidoOptions = () => ({ challenge: new Uint8Array([1]) });
  context.fidoAttestation = () => '{}';
  let createBody;
  context.mfaApi = async (url, options) => {
    if (!url.endsWith('/devices')) return { status: 'ACTIVE' };
    createBody = JSON.parse(options.body);
    return { id: '11111111-1111-4111-8111-111111111111', status: 'ACTIVATION_REQUIRED', publicKeyCredentialCreationOptions: '{}' };
  };
  let completed = false;
  context.finishMfaEnrollment = async () => { completed = true; };
  await context.createFidoAuthenticator();
  assert.equal(completed, true);
  assert.deepEqual(createBody, { type: 'FIDO2', rp: { id: 'johnpelquingua.github.io', name: 'North Bank' } });
  context.fidoOptions = originalFidoOptions;
  context.fidoAttestation = originalFidoAttestation;
  context.document = undefined;
  evaluate('session=null');
});

test('FIDO2 enrollment options retain PingOne challenge bytes', () => {
  const options = evaluate(`fidoOptions(JSON.stringify({challenge:[-1,2],user:{id:[-128,3]},excludeCredentials:[{type:'public-key',id:[-2,4]}]}))`);
  assert.deepEqual([...options.challenge], [255, 2]);
  assert.deepEqual([...options.user.id], [128, 3]);
  assert.deepEqual([...options.excludeCredentials[0].id], [254, 4]);
});

test('authenticator QR encodes the PingOne enrollment URI locally', () => {
  const qrcode = require('../vendor/qrcode.js');
  const secret = 'JBSWY3DPEHPK3PXP';
  const keyUri = `otpauth://totp/test.user?secret=${secret}`;
  const uri = evaluate(`totpEnrollmentUri({secret:'${secret}',keyUri:'${keyUri}'},{username:'test.user'})`);
  assert.equal(uri, keyUri);
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  assert.match(qr.createSvgTag({cellSize:5,margin:20,scalable:true}), /^<svg\b/);
  const other = evaluate(`totpEnrollmentUri({secret:'${secret}',keyUri:'otpauth://totp/test.user?secret=WRONG'},{username:'test.user'})`);
  assert.equal(new URL(other).searchParams.get('secret'), secret);
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
  assert.equal(url.searchParams.get('scope'), 'openid profile email phone address p1:read:device p1:create:device p1:update:device p1:update:userMfaEnabled');
  assert.equal(request.options.credentials, 'include');
  assert.equal(receivedFlow, flow);
  assert.equal(JSON.parse(context.pending.value).mode, 'flow');
});
