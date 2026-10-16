# North Bank shared SSO rollout

## Deployment order
1. Deploy the updated main-branch supabase/functions/bank-demo/index.mjs to the existing bank-demo Edge Function. Keep recognize.mjs, recognize-status.mjs and mfa-fallback.mjs in the same bundle. Keep Supabase legacy Verify JWT disabled: this function validates PingOne credentials itself. There is no SQL change.
2. Wait for the Access Hub Cloudflare production build containing public/north-signon.html and the shared sign-in script.
3. In PingOne North Bank Web CIAM, retain the existing GitHub Pages redirect and signoff URL. Add https://jportal-nsph.com to the allowed CORS origins, keeping https://johnpelquingua.github.io. Set Home Page URL to https://johnpelquingua.github.io/north-bank-identity-demo/ and Signon URL to https://jportal-nsph.com/north-signon.html.
4. Publish the frontend changes from this branch to main. The bank remains a public PKCE SPA; never add a client secret. No tokens are handed from the portal to the bank in URLs. The shared PingOne issuer is https://auth.jportal-nsph.com/as.
5. After the frontend is deployed, set Supabase secret NORTH_BANK_REQUIRE_ACTIVE_SESSION=true to reject old clients that omit the session access token. This enables a live PingOne UserInfo check on all bank API requests. Portal-issued ID tokens still fail the bank client audience check.
6. Test with third-party cookies blocked. Portal launch uses an entry hint only to select SSO prompting; it grants no access. Fresh direct bank visits request credentials. A refresh in an authenticated bank tab uses the existing provider session to recover without persisting tokens. The Access Hub sidebar link rechecks the provider identity before the portal creates a new local session.
7. Sign out from either app. North Bank signout clears memory and navigates through the portal logout endpoint, clearing hub cookies and ending PingOne SSO. Other open bank tabs revalidate on focus and every 30 seconds; new protected bank API requests are checked immediately against UserInfo. Browser back/forward cache restores re-establish through PingOne instead of trusting stale dashboard memory.

## Account continuity
Both the standard and custom issuers must pass signature/client validation. The ledger continues using its original issuer namespace and the stable subject, preserving existing fictional balances and transfer history.

## Remaining configuration checks
Check the North Bank application group access restriction and its MFA policy with an assigned user and an unassigned user. Existing GitHub-domain passkeys are not valid on the hosted portal-domain login form; use TOTP/email first and plan a separate approved FIDO policy/enrollment. A redirect can still require MFA when the assigned policy demands it.
