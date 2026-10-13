'use strict';

// This page is the OIDC application's Signon URL. PingOne sends a short-lived
// flow ID here; the browser never stores a username or password for the flow.
const issuer = 'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as';
const environmentId = '22f37616-5cf6-47ee-8111-f0c870cbfa8f';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let currentFlow;
let currentFlowUrl;
let inlineFlowId;
let pollTimer;
let busy = false;

function flowEndpoint(id) {
  if (!uuid.test(id || '')) throw Error('Invalid sign-in request.');
  return new URL(`/${environmentId}/flows/${id}`, issuer).href;
}

function signonRequest(query) {
  const id = query.get('flowId');
  if (!id) return null;
  const requestedEnvironment = query.get('environmentId');
  if (requestedEnvironment && requestedEnvironment !== environmentId) {
    throw Error('This sign-in link is invalid. Start again.');
  }
  return flowEndpoint(id);
}

function validatedFlowEndpoint(flow) {
  if (flow?.environment?.id !== environmentId) throw Error('PingOne returned a sign-in flow for another environment.');
  return flowEndpoint(flow.id);
}

function beginFlow(flow) {
  currentFlowUrl = validatedFlowEndpoint(flow);
  inlineFlowId = flow.id;
  renderFlow(flow);
}

function actionEndpoint(flow, action, expectedUrl) {
  const href = flow?._links?.[action]?.href;
  if (href !== expectedUrl) throw Error('PingOne returned an unexpected sign-in action.');
  return href;
}

function resumeEndpoint(flow, id) {
  const url = new URL(flow?.resumeUrl || '');
  const expected = new URL(issuer);
  if (url.origin !== expected.origin ||
      url.pathname !== `/${environmentId}/as/resume` ||
      url.searchParams.get('flowId') !== id ||
      url.username || url.password || url.hash) {
    throw Error('PingOne returned an unexpected sign-in destination.');
  }
  return url.href;
}

function showError(message) {
  const box = document.querySelector('#flow-error');
  box.textContent = message;
  box.hidden = false;
}

function clearError() {
  const box = document.querySelector('#flow-error');
  box.textContent = '';
  box.hidden = true;
}

function setPasswordVisible(visible) {
  const password = document.querySelector('#password');
  const toggle = document.querySelector('#toggle-password');
  if (!password || !toggle) return;
  password.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.title = visible ? 'Hide password' : 'Show password';
}

function showStep(name) {
  for (const id of ['credentials', 'otp-step', 'device-step', 'push-step', 'fido-step']) {
    document.getElementById(id).hidden = id !== name;
  }
}

function ensureMfaControls() {
  if (document.querySelector('#fido-step')) return;
  const parent = document.querySelector('#push-step').parentElement;
  const fido = document.createElement('div');
  fido.id = 'fido-step';
  fido.hidden = true;
  fido.innerHTML = '<p>Use your passkey, security key, or device biometrics.</p><button class="btn wide" id="fido-verify" type="button">Verify with passkey or security key</button>';
  const change = document.createElement('button');
  change.id = 'change-device';
  change.className = 'action';
  change.type = 'button';
  change.textContent = 'Use another verification method';
  change.hidden = true;
  const notice = parent.querySelector('.login-notice, .signon-help');
  parent.insertBefore(fido, notice);
  parent.insertBefore(change, notice);
  fido.querySelector('button').addEventListener('click', verifyFidoAssertion);
  change.addEventListener('click', () => {
    clearTimeout(pollTimer);
    clearError();
    document.querySelector('#flow-status').textContent = 'Choose how to verify your sign-in.';
    showStep('device-step');
  });
}

function populateDevices(flow) {
  const select = document.querySelector('#device');
  select.replaceChildren();
  for (const device of flow._embedded?.devices || []) {
    if (!uuid.test(device.id || '')) continue;
    const option = document.createElement('option');
    option.value = device.id;
    const label = { TOTP: 'Authenticator app', FIDO2: 'Passkey or security key', MOBILE: 'Mobile app' }[device.type] || device.type;
    option.textContent = [label, device.nickname || device.phone || device.email || ''].filter(Boolean).join(' · ');
    select.append(option);
  }
  return select.options.length;
}

function bytes(value) {
  if (Array.isArray(value)) return Uint8Array.from(value.map(byte => byte & 255));
  if (typeof value !== 'string') throw Error('PingOne returned invalid passkey options.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

function base64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function requestCredentialOptions(raw) {
  const options = JSON.parse(raw);
  options.challenge = bytes(options.challenge);
  options.allowCredentials = (options.allowCredentials || []).map(item => ({ ...item, id: bytes(item.id) }));
  return options;
}

function credentialAssertion(credential) {
  return JSON.stringify({
    id: credential.id, type: credential.type, rawId: base64(credential.rawId),
    response: {
      clientDataJSON: base64(credential.response.clientDataJSON),
      authenticatorData: base64(credential.response.authenticatorData),
      signature: base64(credential.response.signature),
      userHandle: credential.response.userHandle ? base64(credential.response.userHandle) : null
    },
    clientExtensionResults: credential.getClientExtensionResults()
  });
}

async function verifyFidoAssertion() {
  try {
    if (!navigator.credentials?.get || !currentFlow?.publicKeyCredentialRequestOptions) throw Error('This browser cannot use passkeys for this sign-in.');
    const publicKey = requestCredentialOptions(currentFlow.publicKeyCredentialRequestOptions);
    const credential = await navigator.credentials.get({ publicKey });
    if (!credential) return;
    await submitFlow('assertion.check', 'assertion.check', { origin: location.origin, assertion: credentialAssertion(credential), compatibility: 'FULL' });
  } catch (error) { showError(error.message); }
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('form button').forEach(button => { button.disabled = value; });
  const fidoButton = document.querySelector('#fido-verify');
  if (fidoButton) fidoButton.disabled = value;
}

function renderFlow(flow) {
  ensureMfaControls();
  clearTimeout(pollTimer);
  currentFlow = flow;
  clearError();
  const status = document.querySelector('#flow-status');
  const restart = document.querySelector('#restart');
  restart.hidden = true;
  const deviceCount = populateDevices(flow);
  const canSwitch = deviceCount > 1 && flow._links?.['device.select']?.href === currentFlowUrl;
  document.querySelector('#change-device').hidden = !canSwitch;
  switch (flow.status) {
    case 'USERNAME_PASSWORD_REQUIRED':
    case 'PASSWORD_REQUIRED':
      actionEndpoint(flow, 'usernamePassword.check', currentFlowUrl);
      showStep('credentials');
      status.textContent = 'Enter your AD username and password.';
      document.querySelector('#password').value = '';
      setPasswordVisible(false);
      document.querySelector('#username').readOnly = false;
      if (flow.status === 'PASSWORD_REQUIRED' && flow.username) {
        document.querySelector('#username').value = flow.username;
        document.querySelector('#username').readOnly = true;
      }
      setBusy(false);
      break;
    case 'OTP_REQUIRED':
      actionEndpoint(flow, 'otp.check', currentFlowUrl);
      showStep('otp-step');
      status.textContent = 'Enter the code from your authenticator app or selected verification method.';
      document.querySelector('#otp').value = '';
      setBusy(false);
      break;
    case 'DEVICE_SELECTION_REQUIRED': {
      actionEndpoint(flow, 'device.select', currentFlowUrl);
      if (!deviceCount) throw Error('No supported verification device is available.');
      showStep('device-step');
      status.textContent = 'Choose how to verify your sign-in.';
      setBusy(false);
      break;
    }
    case 'ASSERTION_REQUIRED':
      actionEndpoint(flow, 'assertion.check', currentFlowUrl);
      showStep('fido-step');
      status.textContent = 'Verify with your passkey or security key.';
      setBusy(false);
      break;
    case 'PUSH_CONFIRMATION_REQUIRED':
      showStep('push-step');
      status.textContent = 'Waiting for approval on your device…';
      pollTimer = setTimeout(refreshFlow, 3000);
      break;
    case 'COMPLETED':
      status.textContent = 'Completing sign-in…';
      if (inlineFlowId) completeInlineFlow(flow).catch(error => {
        showError(error.message);
        status.textContent = 'Sign-in could not complete.';
        restart.hidden = false;
      });
      else location.assign(resumeEndpoint(flow, new URLSearchParams(location.search).get('flowId')));
      break;
    case 'FAILED':
    case 'PUSH_CONFIRMATION_TIMED_OUT':
      showStep('');
      status.textContent = 'Sign-in could not be completed.';
      restart.hidden = false;
      break;
    default:
      showStep('');
      status.textContent = 'This sign-in step needs administrator configuration.';
      restart.hidden = false;
  }
}

async function requestFlow(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      ...options
    });
  } catch {
    const endpoint = new URL(url);
    throw Error(`Browser could not reach ${endpoint.hostname}${endpoint.pathname}. Check this request in the browser Network tab.`);
  }
  if (!response.ok) {
    const error = Error(response.status === 401 || response.status === 400
      ? 'Those credentials or verification details were not accepted. Try again.'
      : 'PingOne could not complete sign-in. Start again.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function completeInlineFlow(flow) {
  const result = await requestFlow(resumeEndpoint(flow, inlineFlowId), {
    headers: { 'X-Requested-With': 'ping-sdk' }
  });
  const code = result?.authorizeResponse?.code;
  if (typeof code !== 'string' || !code || code.length > 2048) {
    throw Error('PingOne did not return a valid sign-in code.');
  }
  const pending = JSON.parse(sessionStorage.getItem('north.pending') || 'null');
  if (pending?.mode !== 'flow') throw Error('Sign-in request expired. Start again.');
  history.replaceState({}, '', new URL(`?code=${encodeURIComponent(code)}&state=${encodeURIComponent(pending.state)}`, location.href));
  await callback();
  render();
}

async function refreshFlow() {
  try {
    renderFlow(await requestFlow(currentFlowUrl));
  } catch (error) {
    showError(error.message);
    document.querySelector('#restart').hidden = false;
  }
}

async function submitFlow(action, mediaType, payload) {
  if (busy || !currentFlow) return;
  const url = actionEndpoint(currentFlow, action, currentFlowUrl);
  setBusy(true);
  clearError();
  try {
    const next = await requestFlow(url, {
      method: 'POST',
      headers: { 'Content-Type': `application/vnd.pingidentity.${mediaType}+json` },
      body: JSON.stringify(payload)
    });
    renderFlow(next);
  } catch (error) {
    // A failed credential check can leave the same flow available for retry.
    try { renderFlow(await requestFlow(currentFlowUrl)); } catch { /* Retry uses current state. */ }
    showError(error.message);
    setBusy(false);
  }
}

async function boot() {
  if (location.pathname.endsWith('/signon.html')) {
    const home = new URL('./', location.href);
    home.search = location.search;
    location.replace(home.href);
    return;
  }
  const query = new URLSearchParams(location.search);
  if (!document.querySelector('#credentials')) return;
  if (query.has('flowId')) currentFlowUrl = signonRequest(query);
  document.querySelector('#toggle-password')?.addEventListener('click', () => {
    setPasswordVisible(document.querySelector('#password').type === 'password');
  });
  document.querySelector('#credentials').addEventListener('submit', event => {
    event.preventDefault();
    const password = document.querySelector('#password');
    const payload = { username: document.querySelector('#username').value.trim(), password: password.value };
    password.value = '';
    setPasswordVisible(false);
    submitFlow('usernamePassword.check', 'usernamePassword.check', payload);
  });
  document.querySelector('#otp-step').addEventListener('submit', event => {
    event.preventDefault();
    const otp = document.querySelector('#otp');
    const payload = { otp: otp.value.trim() };
    otp.value = '';
    submitFlow('otp.check', 'otp.check', payload);
  });
  document.querySelector('#device-step').addEventListener('submit', event => {
    event.preventDefault();
    submitFlow('device.select', 'device.select', { device: { id: document.querySelector('#device').value } });
  });
  if (currentFlowUrl) renderFlow(await requestFlow(currentFlowUrl));
}

if (typeof document !== 'undefined') {
  boot().catch(error => {
    showError(error.message);
    document.querySelector('#flow-status').textContent = 'Sign-in could not start.';
    document.querySelector('#restart').hidden = false;
  });
}

if (typeof module !== 'undefined') module.exports = { flowEndpoint, signonRequest, validatedFlowEndpoint, actionEndpoint, resumeEndpoint, requestCredentialOptions };
