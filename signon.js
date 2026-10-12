'use strict';

// This page is the OIDC application's Signon URL. PingOne sends a short-lived
// flow ID here; the browser never stores a username or password for the flow.
const issuer = 'https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as';
const environmentId = '22f37616-5cf6-47ee-8111-f0c870cbfa8f';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let currentFlow;
let currentFlowUrl;
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

function showStep(name) {
  for (const id of ['credentials', 'otp-step', 'device-step', 'push-step']) {
    document.getElementById(id).hidden = id !== name;
  }
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('form button').forEach(button => { button.disabled = value; });
}

function renderFlow(flow) {
  clearTimeout(pollTimer);
  currentFlow = flow;
  clearError();
  const status = document.querySelector('#flow-status');
  const restart = document.querySelector('#restart');
  restart.hidden = true;
  switch (flow.status) {
    case 'USERNAME_PASSWORD_REQUIRED':
    case 'PASSWORD_REQUIRED':
      actionEndpoint(flow, 'usernamePassword.check', currentFlowUrl);
      showStep('credentials');
      status.textContent = 'Enter your AD username and password.';
      document.querySelector('#password').value = '';
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
      status.textContent = 'Enter the verification code sent to your device.';
      document.querySelector('#otp').value = '';
      setBusy(false);
      break;
    case 'DEVICE_SELECTION_REQUIRED': {
      actionEndpoint(flow, 'device.select', currentFlowUrl);
      const select = document.querySelector('#device');
      select.replaceChildren();
      for (const device of flow._embedded?.devices || []) {
        if (!uuid.test(device.id || '')) continue;
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = [device.type, device.phone || device.email || ''].filter(Boolean).join(' · ');
        select.append(option);
      }
      if (!select.options.length) throw Error('No supported verification device is available.');
      showStep('device-step');
      status.textContent = 'Choose how to verify your sign-in.';
      setBusy(false);
      break;
    }
    case 'PUSH_CONFIRMATION_REQUIRED':
      showStep('push-step');
      status.textContent = 'Waiting for approval on your device…';
      pollTimer = setTimeout(refreshFlow, 3000);
      break;
    case 'COMPLETED':
      status.textContent = 'Completing sign-in…';
      location.assign(resumeEndpoint(flow, new URLSearchParams(location.search).get('flowId')));
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
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    ...options
  });
  if (!response.ok) {
    const error = Error(response.status === 401 || response.status === 400
      ? 'Those credentials or verification details were not accepted. Try again.'
      : 'PingOne could not complete sign-in. Start again.');
    error.status = response.status;
    throw error;
  }
  return response.json();
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
  const query = new URLSearchParams(location.search);
  currentFlowUrl = signonRequest(query);
  if (!currentFlowUrl) {
    location.replace(new URL('./', location.href).href);
    return;
  }
  document.querySelector('#credentials').addEventListener('submit', event => {
    event.preventDefault();
    const password = document.querySelector('#password');
    const payload = { username: document.querySelector('#username').value.trim(), password: password.value };
    password.value = '';
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
  renderFlow(await requestFlow(currentFlowUrl));
}

if (typeof document !== 'undefined') {
  boot().catch(error => {
    showError(error.message);
    document.querySelector('#flow-status').textContent = 'Sign-in could not start.';
    document.querySelector('#restart').hidden = false;
  });
}

if (typeof module !== 'undefined') module.exports = { flowEndpoint, signonRequest, actionEndpoint, resumeEndpoint };

