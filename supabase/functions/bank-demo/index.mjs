// North Bank fictional transfer API. No real funds or payment rails are involved.
import { authorizeRecognizeUser, recognizeTransactionData, verifyRecognizeProof } from './recognize.mjs';
const ISSUER = 'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as';
const CLIENT_ID = 'b62c72a0-1d23-4351-8f67-77054a795169';
const ALLOWED_ORIGINS = new Set(['https://johnpelquingua.github.io', 'http://localhost:8080']);

class BankError extends Error {
  constructor(message, status = 400, code = '') { super(message); this.status = status; this.code = code; }
}

const decodeBase64Url = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const parseJwtPart = value => JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));

export async function verifyPingOneToken(token, fetcher = fetch, cryptoApi = crypto, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 12000) throw new BankError('Sign in again.', 401);
  const parts = token.split('.');
  if (parts.length !== 3) throw new BankError('Sign in again.', 401);
  let header, claims;
  try { header = parseJwtPart(parts[0]); claims = parseJwtPart(parts[1]); }
  catch { throw new BankError('Sign in again.', 401); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new BankError('Sign in again.', 401);
  const seconds = now / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audiences.includes(CLIENT_ID) ||
      ((audiences.length > 1 || claims.azp) && claims.azp !== CLIENT_ID) ||
      typeof claims.exp !== 'number' || claims.exp <= seconds ||
      typeof claims.iat !== 'number' || claims.iat > seconds + 60 ||
      (claims.nbf !== undefined && claims.nbf > seconds + 60) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200) {
    throw new BankError('Sign in again.', 401);
  }
  const discoveryResponse = await fetcher(ISSUER + '/.well-known/openid-configuration');
  if (!discoveryResponse.ok) throw new BankError('Identity verification is temporarily unavailable.', 503);
  const discovery = await discoveryResponse.json();
  const jwksUrl = new URL(discovery.jwks_uri);
  if (discovery.issuer !== ISSUER || jwksUrl.origin !== new URL(ISSUER).origin ||
      !jwksUrl.pathname.startsWith(new URL(ISSUER).pathname + '/') || jwksUrl.search || jwksUrl.hash) {
    throw new BankError('Identity verification is temporarily unavailable.', 503);
  }
  const keysResponse = await fetcher(jwksUrl.href);
  if (!keysResponse.ok) throw new BankError('Identity verification is temporarily unavailable.', 503);
  const keys = await keysResponse.json();
  const jwk = keys.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'));
  if (!jwk) throw new BankError('Sign in again.', 401);
  let valid = false;
  try {
    const key = await cryptoApi.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await cryptoApi.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch { throw new BankError('Sign in again.', 401); }
  if (!valid) throw new BankError('Sign in again.', 401);
  return claims;
}

function response(body, status, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getSecret(getEnv) {
  const keys = JSON.parse(getEnv('SUPABASE_SECRET_KEYS') || '{}');
  const secret = keys.default || getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (typeof secret !== 'string' || !(secret.startsWith('sb_secret_') || secret.split('.').length === 3)) throw new BankError('Transfer service is not configured.', 503);
  return secret;
}

async function rpc(name, payload, fetcher, getEnv) {
  const url = getEnv('SUPABASE_URL');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || '')) throw new BankError('Transfer service is not configured.', 503);
  const result = await fetcher(url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: getSecret(getEnv), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    let detail = {};
    try { detail = await result.json(); } catch { /* No database details in client responses. */ }
    const known = {
      INVALID_AMOUNT: ['Enter a valid amount.', 400],
      INVALID_REQUEST_ID: ['Try this transfer again.', 400],
      RECIPIENT_NOT_FOUND: ['That recipient account was not found.', 404],
      SAME_ACCOUNT: ['Choose another account.', 400],
      INSUFFICIENT_FUNDS: ['Insufficient sample balance.', 400],
      REQUEST_ID_REUSED: ['This transfer request has already been used.', 409],
      RECOGNIZE_REQUIRED: ['Face verification is needed to continue.', 428],
    };
    const match = Object.entries(known).find(([code]) => detail.message?.includes(code));
    if (match) throw new BankError(...match[1], match[0]);
    throw new BankError('Transfer service is temporarily unavailable.', 503);
  }
  return result.json();
}

async function accountView(account, fetcher, getEnv) {
  const history = await rpc('demo_account_history', { p_account_id: account.id, p_limit: 100 }, fetcher, getEnv);
  return { account: { accountNumber: account.account_number, displayName: account.display_name, balanceCents: account.balance_cents }, history };
}

async function recognizeChallenge(claims, transactionData, getEnv, cryptoApi) {
  const customer = getEnv('RECOGNIZE_CUSTOMER_NAME');
  const serviceUrl = getEnv('RECOGNIZE_AUTH_SERVICE_URL');
  if (getEnv('RECOGNIZE_ENABLED') !== 'true' || !customer ||
      !/^https:\/\/[^/]+\/?$/.test(serviceUrl || '') || !getEnv('RECOGNIZE_JWKS_URL')) {
    throw new BankError('Face verification is not ready. Your transfer was not sent.', 503);
  }
  try {
    return { customer, serviceUrl, username: claims.sub, transactionData,
      authorizationToken: await authorizeRecognizeUser(claims.sub, getEnv, cryptoApi) };
  } catch {
    throw new BankError('Face verification is not ready. Your transfer was not sent.', 503);
  }
}

export async function handleBankRequest(request, dependencies = {}) {
  const origin = request.headers.get('Origin');
  const fetcher = dependencies.fetcher || fetch;
  const getEnv = dependencies.getEnv || (name => Deno.env.get(name));
  const cryptoApi = dependencies.cryptoApi || crypto;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: 'Origin not allowed.' }, 403, null);
  if (request.method === 'OPTIONS') return response({}, 200, origin);
  if (request.method !== 'GET' && request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405, origin);
  try {
    const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') || '');
    if (!match) throw new BankError('Sign in again.', 401);
    const claims = await verifyPingOneToken(match[1], fetcher, cryptoApi);
    const label = String(claims.name || claims.preferred_username || claims.email || 'Customer').slice(0, 100);
    const accounts = await rpc('ensure_demo_account', { p_issuer: ISSUER, p_subject: claims.sub, p_display_name: label }, fetcher, getEnv);
    const account = accounts?.[0];
    if (!account) throw new BankError('Transfer service is temporarily unavailable.', 503);
    if (request.method === 'GET') return response(await accountView(account, fetcher, getEnv), 200, origin);
    const raw = await request.text();
    if (raw.length > 15000) throw new BankError('Transfer request is too large.', 400);
    let input;
    try { input = JSON.parse(raw); } catch { throw new BankError('Enter a valid transfer.', 400); }
    if (!/^\d{10}$/.test(input?.recipientAccountNumber || '') ||
        !Number.isSafeInteger(input?.amountCents) || input.amountCents < 1 || input.amountCents > 100000000 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.requestId || '')) {
      throw new BankError('Enter a valid account number and amount.', 400);
    }
    const transactionData = recognizeTransactionData({
      issuer: ISSUER, subject: claims.sub, recipientAccountNumber: input.recipientAccountNumber,
      amountCents: input.amountCents, requestId: input.requestId,
    });
    if (input.action === 'recognize-challenge') {
      return response({ recognize: await recognizeChallenge(claims, transactionData, getEnv, cryptoApi) }, 200, origin);
    }
    let faceVerified = false;
    if (input.recognizeJwt !== undefined) {
      if (getEnv('RECOGNIZE_ENABLED') !== 'true') throw new BankError('Face verification is not ready.', 503);
      try { await verifyRecognizeProof(input.recognizeJwt, transactionData, getEnv, fetcher, cryptoApi); faceVerified = true; }
      catch { throw new BankError('Face verification could not be confirmed. Please try again.', 403); }
    }
    let receipt;
    try { receipt = await rpc('make_demo_transfer', {
      p_issuer: ISSUER, p_sender_subject: claims.sub, p_recipient_account_number: input.recipientAccountNumber,
      p_amount_cents: input.amountCents, p_request_id: input.requestId, p_face_verified: faceVerified,
    }, fetcher, getEnv); }
    catch (error) {
      if (error.code !== 'RECOGNIZE_REQUIRED') throw error;
      return response({ code: 'RECOGNIZE_REQUIRED', error: error.message,
        recognize: await recognizeChallenge(claims, transactionData, getEnv, cryptoApi) }, 428, origin);
    }
    const refreshed = await rpc('ensure_demo_account', { p_issuer: ISSUER, p_subject: claims.sub, p_display_name: label }, fetcher, getEnv);
    return response({ receipt, ...await accountView(refreshed[0], fetcher, getEnv) }, 200, origin);
  } catch (error) {
    if (error instanceof BankError) return response({ error: error.message, code: error.code }, error.status, origin);
    return response({ error: 'Transfer service is temporarily unavailable.' }, 503, origin);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(request => handleBankRequest(request));

