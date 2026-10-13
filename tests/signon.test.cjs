const test = require('node:test');
const assert = require('node:assert/strict');
const { flowEndpoint, signonRequest, validatedFlowEndpoint, actionEndpoint, resumeEndpoint, requestCredentialOptions } = require('../signon.js');

const id = '0370bd50-0f2a-4749-afd4-195a63553372';
const expected = `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/flows/${id}`;

test('custom sign-in only calls flows in the North Bank environment', () => {
  assert.equal(flowEndpoint(id), expected);
  assert.throws(() => flowEndpoint('../as/token'), /Invalid sign-in request/);
  assert.equal(actionEndpoint({ _links: { 'usernamePassword.check': { href: expected } } }, 'usernamePassword.check', expected), expected);
  assert.throws(() => actionEndpoint({ _links: { 'usernamePassword.check': { href: 'https://example.com/steal' } } }, 'usernamePassword.check', expected), /unexpected sign-in action/);
});

test('sign-in link accepts a valid flow without an environment parameter', () => {
  assert.equal(signonRequest(new URLSearchParams({ flowId: id })), expected);
  assert.equal(signonRequest(new URLSearchParams({ flowId: id, environmentId: '22f37616-5cf6-47ee-8111-f0c870cbfa8f' })), expected);
  assert.equal(signonRequest(new URLSearchParams()), null);
  assert.throws(() => signonRequest(new URLSearchParams({ flowId: id, environmentId: '00000000-0000-0000-0000-000000000000' })), /invalid/);
  assert.throws(() => signonRequest(new URLSearchParams({ flowId: '../as/token' })), /Invalid sign-in request/);
});

test('inline sign-in only accepts a flow from the configured environment', () => {
  assert.equal(validatedFlowEndpoint({ id, environment: { id: '22f37616-5cf6-47ee-8111-f0c870cbfa8f' } }), expected);
  assert.throws(() => validatedFlowEndpoint({ id, environment: { id: '00000000-0000-0000-0000-000000000000' } }), /another environment/);
  assert.throws(() => validatedFlowEndpoint({ id: '../as/token', environment: { id: '22f37616-5cf6-47ee-8111-f0c870cbfa8f' } }), /Invalid sign-in request/);
});

test('completed sign-in only resumes at the trusted PingOne endpoint', () => {
  const resumeUrl = `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as/resume?flowId=${id}`;
  assert.equal(resumeEndpoint({ resumeUrl }, id), resumeUrl);
  assert.throws(() => resumeEndpoint({ resumeUrl: 'https://example.com/steal?flowId=' + id }, id), /unexpected sign-in destination/);
  assert.throws(() => resumeEndpoint({ resumeUrl: resumeUrl.replace(id, '00000000-0000-0000-0000-000000000000') }, id), /unexpected sign-in destination/);
});

test('FIDO2 challenge bytes are converted for the browser credential API', () => {
  const options = requestCredentialOptions(JSON.stringify({
    challenge: [-1, 0, 127],
    allowCredentials: [{ type: 'public-key', id: [-128, 1] }]
  }));
  assert.deepEqual([...options.challenge], [255, 0, 127]);
  assert.deepEqual([...options.allowCredentials[0].id], [128, 1]);
});

