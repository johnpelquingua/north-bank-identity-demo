# North Bank Identity Demo

A responsive, fictional banking interface for testing **PingOne sign-in backed by Microsoft Active Directory and PingOne MFA**. It includes a login page, account overview, transaction history, profile, simulated transfers, CSV export, and an in-app setup guide.

App URL after GitHub Pages deployment: https://johnpelquingua.github.io/north-bank-identity-demo/

## Sign in

The main North Bank page shows the AD username and password fields immediately. In the background it starts a PingOne `pi.flow` authorization request with PKCE. When PingOne returns a short-lived flow, the Sign in button becomes available. The browser sends entered credentials directly to PingOne; the assigned policy can authenticate against AD through the LDAP gateway and enforce MFA. The password is not stored in browser storage or sent to GitHub Pages. After login, the app reads PingOne UserInfo to populate the profile. After logout or an error, a retry link remains available.

No real money or payment rails are involved. The fictional transfer service uses a shared Supabase database after the one-time deployment below. A successful OIDC login alone does not prove that a fresh MFA challenge occurred; verify policy execution in PingOne authentication logs.

## Run locally

Requirements: a current browser and Python 3 (or any static HTTP server). No package install or build step.

```sh
python3 -m http.server 8080
```

Visit `http://localhost:8080/`. For local PingOne testing, register that exact redirect and post-logout URL, and allow `http://localhost:8080` as a browser origin. The hosted preview's URL needs separate entries. Run `npm test` to check the authentication validation logic; Node.js 20+ is required for tests.

## Deploy with GitHub Pages

In the repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. The `Deploy banking app` workflow runs on pushes to `main` or can be started manually from **Actions**. It checks the application and publishes `index.html`, `style.css`, `app.js`, `banking.js`, `signon.html`, `signon.css`, and `signon.js`.

This repository is public, so GitHub Pages works with GitHub Free. The published app and repository source are visible to anyone.

For PingOne, register these values for this deployment:

| Setting | Value |
| --- | --- |
| Redirect URI | `https://johnpelquingua.github.io/north-bank-identity-demo/` |
| Post-logout redirect URI | `https://johnpelquingua.github.io/north-bank-identity-demo/` |
| Allowed browser origin | `https://johnpelquingua.github.io` |
| Signon URL | `https://johnpelquingua.github.io/north-bank-identity-demo/signon.html` |

The hosted app is preconfigured with the North Bank PingOne sandbox issuer and public application client ID, so customers do not enter either value. The browser calls PingOne's non-redirect Flows API for sign-in; no server secrets are needed by GitHub Pages.

## Connect PingOne to AD

**Authentication-only scope:** AD is the password authority. The North Bank sign-on page handles entered credentials in browser memory and sends them directly to PingOne's Flows API. PingOne looks up the user through its LDAP gateway and asks AD to validate the password. The gateway does not need to copy AD passwords into PingOne or write password or profile changes back to AD. PingOne may create a linked user record on first login so it can issue tokens and apply MFA. This record is in PingOne, not an update to AD.

1. In PingOne, create and enable an **OIDC Single Page App**. Select Authorization Code, response type `code`, token endpoint authentication `NONE`, PKCE enforcement `S256_REQUIRED`, and **RS256** ID token signing. Grant `openid profile email phone address` scopes and map the profile claims you want to display. The `phone` and `address` scopes request the standard `phone_number` and structured `address` claims from UserInfo.
2. Set the redirect URI and post-logout URI to the exact URL shown on the demo's **PingOne setup** page. Configure that page's origin in PingOne CORS settings. Keep the `localhost` and hosted URLs separate.
3. Prepare an AD test user and a directory service account with read access to the intended user search base. Configure a trusted certificate for LDAPS, and ensure the gateway host can reach the AD domain controller and PingOne.
4. Under **Integrations → Gateways**, add an **LDAP gateway** with directory type Microsoft Active Directory, AD hostname, TLS connection (typically port `636` for LDAPS), and service account Bind DN/password. Save its generated gateway credential securely. Install and start the gateway instance on a host that can reach AD and PingOne; verify its status.
5. On the gateway's **Lookup → User Types** tab, add a user type. Set **Password Authority** to **LDAP**, set the AD user search base DN and a unique link attribute such as `sAMAccountName`, and select the PingOne population and attribute mappings needed for OIDC profile claims. Map AD `telephoneNumber` to PingOne's primary/work phone attribute and map AD address attributes such as `streetAddress`, `l`, `st`, `postalCode`, and `c` to the corresponding PingOne address fields if you want those values shown on the North Bank profile. Leave **Enable password changes from PingOne** off for this authentication-only setup. Enable migration on first authentication if the test user does not already have a linked PingOne record. That creates a PingOne identity record; it does not write to AD.
6. Create an authentication policy with a Login step that selects this gateway and user type under **Migrate Gateway Users Upon First Authentication**. Add a PingOne MFA step with the desired factors and enrollment behavior, then assign the policy to the OIDC application. Check that your PingOne tenant has both the primary authentication and MFA capabilities needed for this flow.
7. The hosted app already has the North Bank sandbox issuer and public application client ID. For another environment, use the app's **PingOne setup** page to override these values with that environment's regional issuer URL from OIDC discovery and its public application client ID. Never enter a client secret or LDAP bind password into the app.
8. Open the app with a test AD user. Test both the correct and an incorrect AD password. Check the sign-in events for gateway lookup, AD credential validation, and MFA, then confirm the profile claims are mapped correctly.

## First sign-in authenticator setup

The North Bank sign-in page can pair a TOTP authenticator after PingOne accepts the AD password. It keeps the PingOne access token and setup key in memory only, creates an MFA device for that same PingOne user, checks an authenticator code to activate it, and enables MFA for the user. The next sign-in should require the code in the same North Bank page.

1. In **North Bank Web CIAM → Resources**, allow `p1:read:device`, `p1:create:device`, `p1:update:device`, and `p1:update:userMfaEnabled` in addition to the existing OIDC scopes. The application requests these scopes at sign-in.
2. In **Authentication → MFA Policies**, make sure the policy permits **Authenticator App (TOTP)**. In **Authentication → Authentication**, edit **North_Bank_AD_Login** and add a **Multi-Factor Authentication** step after Login. Select that MFA policy. For a first-time user without a device, choose **Bypass** under **None or incompatible methods** so PingOne can finish password authentication and the North Bank page can show enrollment. Save the policy and assign it to North Bank Web CIAM on the app's **Policies** tab.
3. Allow the North Bank web origin to call the regional PingOne API host in PingOne CORS settings. For this sandbox the API host is `https://api.pingone.sg`; the issuer remains `https://auth.pingone.sg/.../as`.
4. In a private browser window, sign in as a test AD user with no active TOTP device. On the North Bank page, select **Set up authenticator**, enter the displayed key into an authenticator app, then enter its current code to link it. Sign in again and verify that the policy requests an authenticator code before the app opens. Confirm both events in PingOne authentication logs.

**Security boundary:** PingOne's **Bypass** option completes the first password-only authorization when no MFA device exists. The North Bank page hides its demo dashboard until pairing finishes, but this browser-side check does not make the issued token MFA-enforced. Keep this configuration in a test environment. A production banking app needs a server-side authorization boundary and an enrollment journey that PingOne enforces before issuing usable application access. An active device alone does not prove an MFA challenge happened; verify the MFA policy and sign-in event on later logins. If you lose the setup key or its 30-minute window expires, cancel and sign in again to create a new device.

### Customer method choices

In this North Bank Customer sandbox, **Authenticator App** and **TOTP** name the same method. The app offers that method, an email code when PingOne UserInfo has an email address, and FIDO2 passkeys/security keys. Existing users with more than one enrolled device can select another method during the PingOne sign-in flow. A PingOne MFA policy must allow each method and the authentication policy must use that MFA policy.

For FIDO2, create or edit a policy under **Authentication → FIDO**. Set the Relying Party ID to **Other → `johnpelquingua.github.io`** for the hosted North Bank page, and allow both platform and cross-platform authenticators if you want passkeys and security keys. In **Authentication → MFA → North_Bank_Authenticator**, enable FIDO2, select the FIDO policy, allow pairing, and save. The WebAuthn relying party must match the website's origin; a custom domain or localhost requires its own FIDO policy and device enrollment. The North Bank app uses this sandbox's `North_Bank_Authenticator` policy ID when creating FIDO2 and email devices.

For email, enable **Email** and **Allow Pairing** in the same MFA policy. Ensure the AD user's `mail` attribute is mapped into PingOne, that UserInfo returns `email`, and that PingOne can send notification emails. The email choice is hidden when UserInfo has no email address.

The screenshot's **Mobile Applications** setting says no native mobile applications are available. It does not enable the PingID mobile app. PingID mobile app enrollment is a Workforce feature; a Customer environment can instead integrate its own native mobile app using PingOne's MFA SDK and pairing keys. This demo does not claim to pair an unavailable mobile app.

### Keep the credential form on the main page

1. Under the application's **Configuration → CORS Settings**, select **Allow specific origins** and allow `https://johnpelquingua.github.io`. Keep Authorization Code, PKCE S256, and the existing redirect URI. The Signon URL can remain set to `signon.html`; the inline `pi.flow` path does not navigate there.
2. Open the main app in a private browser window. Its AD credential form appears immediately while the PingOne flow starts in the background. Test a valid and invalid AD login and the assigned MFA steps. The form currently handles username/password, OTP, device choice, and push approval. Additional policy steps must be implemented before those steps can be used on this page.

Do not put a worker client secret, LDAP bind password, or AD password in repository files or app configuration.

Profile data shown by this demo is read-only after PingOne sign-in. There is no app-to-AD connection, password change, AD writeback, or general directory synchronization in this example.

### Show an AD telephone number in the user profile

The North Bank profile displays the standard OIDC `phone_number` claim returned by PingOne UserInfo. It requests the `phone` scope when signing in; the claim is empty until the source and application mappings are configured.

1. Confirm that the AD user's `telephoneNumber` attribute is populated. If you intend to show a mobile number instead, use AD `mobile` consistently in the following mapping.
2. In **Integrations → Gateways → North Bank AD Gateway → Lookup → North Bank AD Users**, edit **Map Attributes**. Map AD `telephoneNumber` to the PingOne primary/work phone attribute. If the user was already migrated, enable **Update PingOne user attributes as users sign on** so a later AD sign-in refreshes their PingOne record. Check existing mappings before saving, because PingOne can fail authentication if an attribute update fails.
3. In **Applications → Applications → North Bank Web CIAM → Resources**, allow the OIDC **phone** scope. If the application has a custom OIDC attribute mapping, map `phone_number` to the PingOne phone attribute as well.
4. Sign out and sign in again with the AD user. Open **My profile**. If Telephone number remains empty, inspect that user's PingOne directory phone value and the `/userinfo` response; the page intentionally does not invent a number or query AD directly.

### Show an AD address in the user profile

The North Bank profile displays PingOne UserInfo's OIDC `address` claim, using its formatted value when available or combining the street, city, region, postal code, and country fields. The app requests the `address` scope at sign-in. Allowing that scope alone does not populate a user's address.

1. Confirm the relevant AD address attributes are populated for the user. Common attributes include `streetAddress`, `l` (city), `st` (state or province), `postalCode`, and `c` (two-letter country code).
2. In the LDAP gateway user type's **Map Attributes** section, map those AD values to PingOne address fields. For an existing PingOne user, enable **Update PingOne user attributes as users sign on** and save, then sign in again to refresh the record.
3. In **North Bank Web CIAM → Resources**, allow the OIDC **address** scope. If the app overrides its OIDC attribute mapping, make sure it returns the standard `address` claim.
4. Check the user's PingOne directory address, then sign out and sign in again. If the field is still empty, inspect the UserInfo `address` claim. The page does not read AD directly.

## Authentication design

The browser uses OIDC Authorization Code with S256 PKCE and PingOne's non-redirect `pi.flow` response mode. It exchanges the resulting authorization code, verifies the RS256 ID token against PingOne JWKS, checks issuer, audience, authorized party, nonce, issue and expiry times, and matches the UserInfo `sub` to the ID token. Redirect callbacks, if used, also validate `state`. Tokens remain in memory and disappear on reload. The short-lived PKCE transaction is in `sessionStorage` and is removed when the code is redeemed. Public issuer/client ID settings are stored in `localStorage` for convenience.

The issuer allowlist covers several standard PingOne regional hosts. If your tenant uses another supported host, review and update `validateIssuer()` and endpoint checks before testing. The code expects RS256; configure the application accordingly. The user session ends at ID token expiry; there is no refresh-token flow.

The shared transfer feature is a fictional ledger for testing. The Edge Function validates each PingOne token and the database changes both sample balances in one transaction. It does not invoke PingOne MFA step-up or a payment service. It is not suitable for real funds: production would need an API-specific access token, stronger transaction authorization, fraud controls, and an audited ledger.

## Enable shared sample transfers in Supabase

The website is already configured with the public URL of the North Bank Supabase project. Customers never enter this URL or a key. Complete these one-time deployment steps before testing transfers:

1. In the Supabase project dashboard, open **SQL Editor**. Paste and run the full contents of `supabase/migrations/202610130001_bank_demo.sql`. It creates private sample accounts, the transfer table, and database functions. Each PingOne user gets a separate fictional PHP 100,000 opening balance on first access.
2. Deploy `supabase/functions/bank-demo/index.mjs` as the `bank-demo` Edge Function. With the Supabase CLI from the repository root, run `supabase login`, `supabase link --project-ref uxjyitgzrtxgftcpzoxk`, then `supabase functions deploy bank-demo --no-verify-jwt`. The included `supabase/config.toml` points to the function entrypoint. The browser sends a PingOne token, so Supabase's own JWT check must be disabled; the function verifies the PingOne signature, issuer, client ID, and expiration itself.
3. Check the function's logs for deployment errors. The Supabase service key must remain inside the Edge Function environment; do not add it to GitHub Pages or send it to customers. The function uses Supabase's injected `SUPABASE_SECRET_KEYS` or legacy `SUPABASE_SERVICE_ROLE_KEY` environment value.
4. Sign in as two different AD users in separate browsers. Copy User A's 10-digit sample account number from Overview. From User B's Overview, transfer a small amount to that number. Refresh both users' transaction pages; the same transfer should appear as outgoing for B and incoming for A, with both balances updated. The account number can be shared for this test, but do not share passwords or tokens.

Transfers are capped at PHP 1,000,000 each, cannot overdraw an account, and use a request ID so retrying the same request does not debit twice. The history shows the most recent 100 transfers. The savings and spending cards remain illustrations. If the Edge Function is not deployed yet, the signed-in app shows a transfer service error and will not create a misleading browser-only transfer.

## Add Recognize face verification to transfers

This integration is prepared for the North Bank **sandbox** and is inactive until its server settings and database update are deployed. It applies to fictional transfers only. The rule is enforced in PostgreSQL, after locking the sender account: a transfer over PHP 20,000 requires a face check; a PHP 20,000 transfer requires one if that sender already sent PHP 20,000 or more in the previous 10 minutes; smaller transfers do not require one. The browser cannot declare a face check successful. The Edge Function verifies a recent Recognize-signed token containing the exact sender, recipient, amount, and request ID. The request ID also prevents a retry from debiting twice.

Each customer enrolls their face once using Recognize, then authenticates for the transfer. Enrollment alone does not submit a transfer. North Bank uses that customer's PingOne subject as the Recognize username. Recognize's first-factor user authorization must be enabled so a customer cannot enroll under another person's username.

The public sandbox configuration found in **Recognize → Access Control** is:

| Setting | Value |
| --- | --- |
| Customer name | `netpoleons_asia` |
| Authentication Service | `https://authentication-service-sandbox.eks.core-production.keyless.technology/` |
| Operations Service public JWKS | `https://operations-service-sandbox.eks.core-production.keyless.technology/customers/netpoleons_asia/.well-known/jwks.json` |

Opening the root of either service in a browser returns an error; the SDK calls its own service routes. The JWKS path above returns a `keys` array and is public. The dashboard's Mobile API Key and Secret API Keys are not needed by the Web SDK and must never be placed in this repository or in the web page.

### Finish the server setup

1. Generate a signing key locally with `node scripts/create-recognize-key.mjs`. Put the printed `RECOGNIZE_AUTH_PRIVATE_JWK` and `RECOGNIZE_AUTH_KEY_ID` values into **Supabase → Edge Functions → Secrets**. Keep the private JWK out of GitHub and messages.
2. In the same Supabase Secrets area add `RECOGNIZE_CUSTOMER_NAME=netpoleons_asia`, `RECOGNIZE_AUTH_SERVICE_URL=https://authentication-service-sandbox.eks.core-production.keyless.technology/`, and `RECOGNIZE_JWKS_URL=https://operations-service-sandbox.eks.core-production.keyless.technology/customers/netpoleons_asia/.well-known/jwks.json`.
3. Ask the PingOne Recognize/Keyless team to set **User Authorization Type** to `RemoteJWKSet` and **User Authorization JWKs URI** to `https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/bank-demo?jwks=1` for the `netpoleons_asia` sandbox tenant. Ping's documentation says only its staff can change this customer setting. After deployment, visiting that URI should show a public `keys` array, never a private key.
4. During a short transfer maintenance window, run `supabase/migrations/202610130002_recognize_step_up.sql` in the Supabase SQL Editor and deploy **both** `supabase/functions/bank-demo/index.mjs` and `supabase/functions/bank-demo/recognize.mjs` to the existing `bank-demo` function. Keep **Verify JWT with legacy secret** off; the function verifies PingOne tokens itself. The migration removes the old transfer RPC signature so the old function cannot bypass the new rule. Transfers will pause between these two actions.
5. After the Recognize team confirms the user-authorization setting, set `RECOGNIZE_ENABLED=true` in Supabase Secrets. Test with two AD users: an amount below PHP 20,000, a first PHP 20,000, a second PHP 20,000 within 10 minutes, and any amount over PHP 20,000. First-time face users choose **Set up face verification** and then complete a separate verification. Returning users choose **Verify my face**. A canceled or failed face check must leave balances unchanged.

The function verifies Recognize's ES256 or RS256 signature against the tenant's public keys and binds the signed transaction data to the transfer. It does not upload a selfie or store a face image in Supabase. This remains a fictional banking demo, not a production payment system.

## Project files

| Path | Purpose |
| --- | --- |
| `index.html` | Accessible page shell |
| `style.css` | Responsive interface |
| `app.js` | UI, sample data, PingOne OIDC flow |
| `banking.js` | Shared fictional accounts, transfers, and history UI |
| `supabase/migrations/202610130001_bank_demo.sql` | Atomic fictional balance and transfer logic |
| `supabase/functions/bank-demo/index.mjs` | PingOne token verification and protected database API |
| `signon.html`, `signon.css`, `signon.js` | Main-page PingOne flow form and legacy sign-on URL handler |
| `tests/auth.test.cjs` | Token, issuer, and CSV security checks |
| `.github/workflows/checks.yml` | CI syntax and test checks |
| `.github/workflows/pages.yml` | GitHub Pages deployment |

## Validation checklist

Test valid AD login, bad AD password, MFA cancel/deny, gateway outage, redirect mismatch, logout, and expiry. Verify the correct PingOne policy is assigned to the app. If an existing SSO session skips a challenge, inspect the policy and session settings before drawing conclusions about MFA.

Official references: [PingOne SPA configuration](https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---single-page-app.html), [LDAP gateway setup](https://docs.pingidentity.com/pingone/integrations/p1_gateways_overview.html), [LDAP user type and password authority](https://docs.pingidentity.com/pingone/integrations/p1_add_a_user_type.html), and [gateway authentication policy](https://docs.pingidentity.com/pingone/integrations/p1_create_auth_policy_using_the_gateway.html).

