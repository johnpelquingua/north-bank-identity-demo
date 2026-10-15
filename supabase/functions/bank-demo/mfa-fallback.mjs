// PingOne MFA fallback for a single pending fictional transfer.
const ENV_ID = '22f37616-5cf6-47ee-8111-f0c870cbfa8f';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_URL = `https://auth.pingone.sg/${ENV_ID}/deviceAuthentications`;
const POLICY_ID = '28af8459-b2b0-45df-9e2c-2b26107b0270';
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));

async function workerToken(getEnv, fetcher) {
  const id = getEnv('PINGONE_WORKER_CLIENT_ID'), secret = getEnv('PINGONE_WORKER_CLIENT_SECRET');
  if (!UUID.test(id || '') || !secret) throw Error('PingOne MFA fallback is not configured.');
  const response = await fetcher(`https://auth.pingone.sg/${ENV_ID}/as/token`, {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(id + ':' + secret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error('PingOne MFA service is unavailable.');
  const data = await response.json();
  if (typeof data.access_token !== 'string') throw Error('PingOne MFA service is unavailable.');
  return data.access_token;
}

async function pingMfa(path, method, body, contentType, getEnv, fetcher) {
  const token = await workerToken(getEnv, fetcher);
  const response = await fetcher(AUTH_URL + path, {
    method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': contentType } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error(response.status === 403 ? 'PingOne Worker needs MFA device authentication permission.' : 'PingOne could not complete this verification step.');
  return response.json();
}

async function stateKey(getEnv, cryptoApi) {
  const secret = getEnv('PINGONE_WORKER_CLIENT_SECRET');
  if (!secret) throw Error('PingOne MFA fallback is not configured.');
  return cryptoApi.subtle.importKey('raw', encoder.encode('north-bank-mfa-fallback-v1:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sealState(data, getEnv, cryptoApi) {
  const payload = encode(encoder.encode(JSON.stringify(data)));
  const signature = await cryptoApi.subtle.sign('HMAC', await stateKey(getEnv, cryptoApi), encoder.encode(payload));
  return payload + '.' + encode(new Uint8Array(signature));
}

export async function openMfaFallback(subject, transfer, getEnv, fetcher = fetch, cryptoApi = cryptoApiDefault()) {
  if (!UUID.test(subject) || !UUID.test(transfer.requestId)) throw Error('Invalid MFA request.');
  const policy = getEnv('PINGONE_MFA_POLICY_ID') || POLICY_ID;
  if (!UUID.test(policy)) throw Error('PingOne MFA policy is not configured.');
  const flow = await pingMfa('', 'POST', { user: { id: subject }, policy: { id: policy } }, 'application/json', getEnv, fetcher);
  if (!UUID.test(flow.id) || flow.user?.id !== subject ||
      !['DEVICE_SELECTION_REQUIRED', 'OTP_REQUIRED', 'ASSERTION_REQUIRED', 'PUSH_CONFIRMATION_REQUIRED'].includes(flow.status)) {
    throw Error('PingOne did not request a fresh MFA check.');
  }
  const state = await sealState({ id: flow.id, subject, transfer, created: Date.now() }, getEnv, cryptoApi);
  return { state, ...publicFlow(flow) };
}

function cryptoApiDefault() { return globalThis.crypto; }

export async function verifyMfaState(state, subject, transfer, getEnv, cryptoApi = cryptoApiDefault()) {
  if (typeof state !== 'string' || state.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(state)) throw Error('Verification expired. Start again.');
  const [payload, signature] = state.split('.');
  let valid = false, data;
  try {
    valid = await cryptoApi.subtle.verify('HMAC', await stateKey(getEnv, cryptoApi), decode(signature), encoder.encode(payload));
    if (valid) data = JSON.parse(new TextDecoder().decode(decode(payload)));
  } catch { /* Reject malformed state. */ }
  if (!valid || !UUID.test(data?.id || '') || data.subject !== subject || Date.now() - data.created > 300000 ||
      data.created > Date.now() + 10000 || data.transfer?.requestId !== transfer.requestId ||
      data.transfer?.recipientAccountNumber !== transfer.recipientAccountNumber || data.transfer?.amountCents !== transfer.amountCents) {
    throw Error('Verification expired or transfer details changed. Start again.');
  }
  return data.id;
}

function publicFlow(flow) {
  const devices = (flow._embedded?.devices || []).filter(d => d.status === 'ACTIVE' && UUID.test(d.id || '') &&
    ['EMAIL', 'TOTP', 'FIDO2', 'MOBILE'].includes(d.type)).map(d => ({ id: d.id, type: d.type, detail: d.nickname || d.email || '' }));
  return { status: flow.status, devices, selectedDeviceId: UUID.test(flow.selectedDevice?.id || '') ? flow.selectedDevice.id : null,
    publicKeyCredentialRequestOptions: flow.status === 'ASSERTION_REQUIRED' ? flow.publicKeyCredentialRequestOptions : null };
}

export async function advanceMfaFallback(id, action, input, getEnv, fetcher = fetch) {
  if (!UUID.test(id)) throw Error('Invalid MFA challenge.');
  let flow;
  if (action === 'status') flow = await pingMfa('/' + id, 'GET', null, null, getEnv, fetcher);
  else if (action === 'select' && UUID.test(input.deviceId || '')) flow = await pingMfa('/' + id, 'POST', { device: { id: input.deviceId }, compatibility: 'FULL' }, 'application/vnd.pingidentity.device.select+json', getEnv, fetcher);
  else if (action === 'otp' && typeof input.otp === 'string' && /^[0-9]{4,10}$/.test(input.otp)) flow = await pingMfa('/' + id, 'POST', { otp: input.otp }, 'application/vnd.pingidentity.otp.check+json', getEnv, fetcher);
  else if (action === 'assertion' && typeof input.assertion === 'string' && input.assertion.length < 12000) flow = await pingMfa('/' + id, 'POST', { origin: input.origin, assertion: input.assertion, compatibility: 'FULL' }, 'application/vnd.pingidentity.assertion.check+json', getEnv, fetcher);
  else throw Error('Choose a valid verification method.');
  if (flow.id !== id) throw Error('PingOne returned an invalid MFA challenge.');
  return { userId: flow.user?.id, ...publicFlow(flow) };
}
