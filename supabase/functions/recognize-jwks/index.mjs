// Public verification key for Recognize first-factor user authorization.
// The RSA private JWK is held only in Supabase Secrets.
Deno.serve(() => {
  try {
    const privateJwk = JSON.parse(Deno.env.get('RECOGNIZE_AUTH_PRIVATE_JWK') || '');
    const kid = Deno.env.get('RECOGNIZE_AUTH_KEY_ID');
    if (privateJwk.kty !== 'RSA' || !privateJwk.n || !privateJwk.e || !kid) throw Error('Not configured');
    return Response.json({ keys: [{
      kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: privateJwk.n, e: privateJwk.e,
    }] }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch {
    return Response.json({ error: 'Public key is not configured.' }, { status: 503 });
  }
});

