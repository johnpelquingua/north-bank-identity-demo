// Run locally. Copy the private JWK into Supabase Secrets, never into this repo.
import { webcrypto } from 'node:crypto';

const pair = await webcrypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const kid = webcrypto.randomUUID();
console.log('RECOGNIZE_AUTH_KEY_ID=' + kid);
console.log('RECOGNIZE_AUTH_PRIVATE_JWK=' + JSON.stringify(privateJwk));
console.log('Keep the private JWK in Supabase Secrets only. The public key is exposed by bank-demo?jwks=1.');

