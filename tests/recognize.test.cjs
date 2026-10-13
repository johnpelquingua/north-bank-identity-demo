const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64url');

test('Recognize proof must be signed, recent, and tied to the exact transfer', async () => {
  const { recognizeTransactionData, verifyRecognizeProof } = await import('../supabase/functions/bank-demo/recognize.mjs');
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = 'test-key'; jwk.use = 'sig';
  const now = Date.now();
  const data = recognizeTransactionData({
    issuer: 'issuer', subject: 'customer-1', recipientAccountNumber: '7000000001',
    amountCents: 2000001, requestId: '12345678-1234-4123-8123-123456789012',
  });
  async function token(td, iat = Math.floor(now / 1000)) {
    const head = b64(enc.encode(JSON.stringify({ alg: 'ES256', kid: jwk.kid })));
    const body = b64(enc.encode(JSON.stringify({ iat, td })));
    const message = head + '.' + body;
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, enc.encode(message));
    return message + '.' + b64(sig);
  }
  const fetcher = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  const getEnv = name => name === 'RECOGNIZE_JWKS_URL'
    ? 'https://example.test/customers/customer/.well-known/jwks.json' : '';
  const valid = await token(data);
  assert.equal((await verifyRecognizeProof(valid, data, getEnv, fetcher, webcrypto, now)).td, data);
  await assert.rejects(verifyRecognizeProof(valid, data.replace('2000001', '2000002'), getEnv, fetcher, webcrypto, now));
  await assert.rejects(verifyRecognizeProof(await token(data, Math.floor(now / 1000) - 301), data, getEnv, fetcher, webcrypto, now));
  const parts = valid.split('.'); parts[1] = b64(enc.encode(JSON.stringify({ iat: Math.floor(now / 1000), td: data + 'x' })));
  await assert.rejects(verifyRecognizeProof(parts.join('.'), data + 'x', getEnv, fetcher, webcrypto, now));
});

test('user authorization token identifies the signed-in user and publishes only a public key', async () => {
  const { authorizationJwks, authorizeRecognizeUser } = await import('../supabase/functions/bank-demo/recognize.mjs');
  const pair = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const getEnv = name => ({
    RECOGNIZE_AUTH_PRIVATE_JWK: JSON.stringify(privateJwk),
    RECOGNIZE_AUTH_KEY_ID: 'north-bank-test',
  })[name];
  const jwks = authorizationJwks(getEnv);
  assert.equal(jwks.keys[0].d, undefined);
  const jwt = await authorizeRecognizeUser('pingone-subject', getEnv, webcrypto, Date.now());
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
  assert.equal(claims.sub, 'pingone-subject');
  assert.equal(claims.aud, 'authentication-service');
  assert.equal(claims.exp - claims.iat, 300);
  const publicKey = await webcrypto.subtle.importKey('jwk', jwks.keys[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey,
    Buffer.from(jwt.split('.')[2], 'base64url'), enc.encode(jwt.split('.').slice(0, 2).join('.'))), true);
});

test('public Recognize key endpoint never returns the private key', async () => {
  let handler;
  const originalDeno = globalThis.Deno;
  globalThis.Deno = {
    serve: callback => { handler = callback; },
    env: { get: name => ({
      RECOGNIZE_AUTH_PRIVATE_JWK: JSON.stringify({ kty: 'RSA', n: 'public-modulus', e: 'AQAB', d: 'private-exponent' }),
      RECOGNIZE_AUTH_KEY_ID: 'key-1',
    })[name] },
  };
  try {
    await import('../supabase/functions/recognize-jwks/index.mjs');
    const response = handler();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.keys[0].n, 'public-modulus');
    assert.equal(body.keys[0].d, undefined);
    assert.doesNotMatch(JSON.stringify(body), /private-exponent/);
  } finally {
    globalThis.Deno = originalDeno;
  }
});

