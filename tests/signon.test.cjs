const test = require('node:test');
const assert = require('node:assert/strict');
const { flowEndpoint, actionEndpoint, resumeEndpoint } = require('../signon.js');

const id = '0370bd50-0f2a-4749-afd4-195a63553372';
const expected = `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/flows/${id}`;

test('custom sign-in only calls flows in the North Bank environment', () => {
  assert.equal(flowEndpoint(id), expected);
  assert.throws(() => flowEndpoint('../as/token'), /Invalid sign-in request/);
  assert.equal(actionEndpoint({ _links: { 'usernamePassword.check': { href: expected } } }, 'usernamePassword.check', expected), expected);
  assert.throws(() => actionEndpoint({ _links: { 'usernamePassword.check': { href: 'https://example.com/steal' } } }, 'usernamePassword.check', expected), /unexpected sign-in action/);
});

test('completed sign-in only resumes at the trusted PingOne endpoint', () => {
  const resumeUrl = `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as/resume?flowId=${id}`;
  assert.equal(resumeEndpoint({ resumeUrl }, id), resumeUrl);
  assert.throws(() => resumeEndpoint({ resumeUrl: 'https://example.com/steal?flowId=' + id }, id), /unexpected sign-in destination/);
  assert.throws(() => resumeEndpoint({ resumeUrl: resumeUrl.replace(id, '00000000-0000-0000-0000-000000000000') }, id), /unexpected sign-in destination/);
});

