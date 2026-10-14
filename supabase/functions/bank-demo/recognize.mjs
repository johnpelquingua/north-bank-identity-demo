// Recognize proof is checked here, never in the browser.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const parsePart = value => JSON.parse(decoder.decode(unb64url(value)));

export function recognizeTransactionData({ issuer, subject, recipientAccountNumber, amountCents, requestId }) {
  return JSON.stringify({ version: 1, issuer, subject, recipientAccountNumber, amountCents, requestId });
}

export function recognizeEnrollmentData({ issuer, subject, requestId }) {
  return JSON.stringify({ version: 1, type: 'face-enrollment', issuer, subject, requestId });
}

function privateJwk(getEnv) {
  let jwk;
  try { jwk = JSON.parse(getEnv('RECOGNIZE_AUTH_PRIVATE_JWK') || ''); } catch { throw Error('Recognize is not configured.'); }
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e || !jwk.d || !getEnv('RECOGNIZE_AUTH_KEY_ID')) throw Error('Recognize is not configured.');
  return jwk;
}

export function authorizationJwks(getEnv) {
  const jwk = privateJwk(getEnv);
  return { keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256', kid: getEnv('RECOGNIZE_AUTH_KEY_ID'), n: jwk.n, e: jwk.e }] };
}

export async function authorizeRecognizeUser(subject, getEnv, cryptoApi = crypto, now = Date.now()) {
  const jwk = privateJwk(getEnv);
  const key = await cryptoApi.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const issued = Math.floor(now / 1000);
  const header = b64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: getEnv('RECOGNIZE_AUTH_KEY_ID') })));
  const payload = b64url(encoder.encode(JSON.stringify({ sub: subject, aud: 'authentication-service', iat: issued, exp: issued + 300 })));
  const signingInput = header + '.' + payload;
  const signature = await cryptoApi.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  return signingInput + '.' + b64url(new Uint8Array(signature));
}

export async function verifyRecognizeProof(token, expectedData, getEnv, fetcher = fetch, cryptoApi = crypto, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 12000) throw Error('Face verification is required.');
  const parts = token.split('.');
  if (parts.length !== 3) throw Error('Face verification is required.');
  let header, claims;
  try { header = parsePart(parts[0]); claims = parsePart(parts[1]); } catch { throw Error('Face verification is required.'); }
  if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string' || !header.kid ||
      typeof claims.iat !== 'number' || claims.iat > now / 1000 + 60 || claims.iat < now / 1000 - 300 ||
      (claims.exp !== undefined && (typeof claims.exp !== 'number' || claims.exp <= now / 1000)) ||
      claims.td !== expectedData) throw Error('Face verification is required for this transfer.');
  const jwksUrl = getEnv('RECOGNIZE_JWKS_URL');
  let parsedUrl;
  try { parsedUrl = new URL(jwksUrl); } catch { throw Error('Recognize is not configured.'); }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.hash ||
      !parsedUrl.pathname.endsWith('/.well-known/jwks.json')) throw Error('Recognize is not configured.');
  const result = await fetcher(parsedUrl.href);
  if (!result.ok) throw Error('Face verification is temporarily unavailable.');
  const jwks = await result.json();
  const jwk = jwks.keys?.find(key => key.kid === header.kid && (!key.alg || key.alg === header.alg) &&
    key.use === 'sig' && ((header.alg === 'RS256' && key.kty === 'RSA') ||
      (header.alg === 'ES256' && key.kty === 'EC' && key.crv === 'P-256')));
  if (!jwk) throw Error('Face verification could not be confirmed.');
  const algorithm = header.alg === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
  let valid = false;
  try {
    const key = await cryptoApi.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    const verifyAlgorithm = header.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5';
    valid = await cryptoApi.subtle.verify(verifyAlgorithm, key, unb64url(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
  } catch { /* Invalid proof. */ }
  if (!valid) throw Error('Face verification could not be confirmed.');
  return claims;
}
