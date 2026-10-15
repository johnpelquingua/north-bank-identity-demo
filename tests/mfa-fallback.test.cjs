const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const subject = '788d4931-6936-43f2-82ff-178f5762298a';
const authId = '03e1897e-33b0-40b9-b54e-68236769b1fa';
const deviceId = 'ea055ca3-2b5b-4766-9628-95fc03f4ec9b';
const transfer = { recipientAccountNumber: '7000000005', amountCents: 2000001, requestId: '9db357fe-35a8-4dde-9d5f-c57f0e9d704e' };
const getEnv = key => ({ PINGONE_WORKER_CLIENT_ID: 'b62c72a0-1d23-4351-8f67-77054a795169', PINGONE_WORKER_CLIENT_SECRET: 'test-secret' })[key];

test('MFA fallback state is signed and bound to the user and exact pending transfer', async () => {
  const { openMfaFallback, verifyMfaState } = await import('../supabase/functions/bank-demo/mfa-fallback.mjs');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/as/token')) return Response.json({ access_token: 'worker-token' });
    return Response.json({ id: authId, user: { id: subject }, status: 'DEVICE_SELECTION_REQUIRED',
      _embedded: { devices: [{ id: deviceId, type: 'EMAIL', status: 'ACTIVE', email: 'j***@example.com' },
        { id: 'bad', type: 'TOTP', status: 'ACTIVE' }] } }, { status: 201 });
  };
  const challenge = await openMfaFallback(subject, transfer, getEnv, fetcher, webcrypto);
  assert.equal(challenge.devices.length, 1);
  assert.equal(challenge.devices[0].type, 'EMAIL');
  assert.equal(await verifyMfaState(challenge.state, subject, transfer, getEnv, webcrypto), authId);
  await assert.rejects(verifyMfaState(challenge.state, subject, { ...transfer, amountCents: 1 }, getEnv, webcrypto), /changed/);
  await assert.rejects(verifyMfaState(challenge.state, '5a09e544-d235-42d8-afd1-1977c80bdfe9', transfer, getEnv, webcrypto), /changed/);
  await assert.rejects(verifyMfaState(challenge.state.slice(0, -2) + 'xx', subject, transfer, getEnv, webcrypto), /expired|changed/);
  assert.match(calls[1].url, /deviceAuthentications$/);
  assert.deepEqual(JSON.parse(calls[1].options.body).user, { id: subject });
});

test('MFA actions use PingOne server responses and do not infer completion from an OTP', async () => {
  const { advanceMfaFallback } = await import('../supabase/functions/bank-demo/mfa-fallback.mjs');
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/as/token')) return Response.json({ access_token: 'worker-token' });
    return Response.json({ id: authId, user: { id: subject }, status: 'OTP_REQUIRED' });
  };
  const result = await advanceMfaFallback(authId, 'otp', { otp: '123456' }, getEnv, fetcher);
  assert.equal(result.status, 'OTP_REQUIRED');
  assert.equal(result.userId, subject);
  assert.equal(calls[1].options.headers['Content-Type'], 'application/vnd.pingidentity.otp.check+json');
  assert.deepEqual(JSON.parse(calls[1].options.body), { otp: '123456' });
  await assert.rejects(advanceMfaFallback(authId, 'otp', { otp: 'abc' }, getEnv, fetcher), /valid verification/);
});

test('a silently completed PingOne flow cannot be used as a fresh transfer check', async () => {
  const { openMfaFallback } = await import('../supabase/functions/bank-demo/mfa-fallback.mjs');
  const fetcher = async url => url.endsWith('/as/token') ? Response.json({ access_token: 'worker-token' }) :
    Response.json({ id: authId, user: { id: subject }, status: 'COMPLETED', selectedDevice: { id: deviceId } }, { status: 201 });
  await assert.rejects(openMfaFallback(subject, transfer, getEnv, fetcher, webcrypto), /fresh MFA check/);
});
