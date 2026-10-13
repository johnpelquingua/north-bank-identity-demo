// Public verification key for Recognize first-factor user authorization.
// The RSA private JWK is held only in Supabase Secrets.
Deno.serve(() => {
  const rawKey = Deno.env.get('RECOGNIZE_AUTH_PRIVATE_JWK');
  const kid = Deno.env.get('RECOGNIZE_AUTH_KEY_ID');
  const unavailable = code => Response.json({ error: 'Public key is not configured.', code }, { status: 503 });
  if (!rawKey) return unavailable('MISSING_PRIVATE_JWK');
  if (!kid) return unavailable('MISSING_KEY_ID');
  let privateJwk;
  try {
    privateJwk = JSON.parse(rawKey);
  } catch {
    return unavailable('INVALID_PRIVATE_JWK_JSON');
  }
  if (privateJwk?.kty !== 'RSA' || !privateJwk.n || !privateJwk.e || !privateJwk.d) {
    return unavailable('INVALID_PRIVATE_JWK');
  }
  return Response.json({ keys: [{
    kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: privateJwk.n, e: privateJwk.e,
  }] }, { headers: { 'Cache-Control': 'public, max-age=300' } });
});

