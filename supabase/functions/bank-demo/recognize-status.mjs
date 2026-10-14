// Mirror a verified Recognize enrollment into the signed-in user's PingOne profile.
// This is a display flag, never a substitute for a fresh Recognize proof on transfers.
export async function markRecognizeEnrolled(subject, getEnv, fetcher = fetch) {
  const clientId = getEnv('PINGONE_WORKER_CLIENT_ID');
  const clientSecret = getEnv('PINGONE_WORKER_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw Error('PingOne enrollment status is not configured.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)) {
    throw Error('Invalid PingOne user ID.');
  }
  const environmentId = '22f37616-5cf6-47ee-8111-f0c870cbfa8f';
  const tokenResponse = await fetcher(`https://auth.pingone.sg/${environmentId}/as/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(clientId + ':' + clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(4000),
  });
  if (!tokenResponse.ok) throw Error('PingOne Worker app could not authenticate.');
  const token = await tokenResponse.json();
  if (typeof token.access_token !== 'string' || !token.access_token) throw Error('PingOne Worker app returned no access token.');
  const updateResponse = await fetcher(`https://api.pingone.sg/v1/environments/${environmentId}/users/${subject}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recognizeEnrolled: 'true' }),
    signal: AbortSignal.timeout(4000),
  });
  if (!updateResponse.ok) throw Error('PingOne did not accept the enrollment status update.');
}
