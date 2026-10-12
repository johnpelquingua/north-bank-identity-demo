# North Bank Identity Demo

A responsive, fictional banking interface for testing **PingOne sign-in backed by Microsoft Active Directory and PingOne MFA**. It includes a login page, account overview, transaction history, profile, simulated transfers, CSV export, and an in-app setup guide.

App URL after GitHub Pages deployment: https://johnpelquingua.github.io/north-bank-identity-demo/

## Sign in

The main North Bank page shows the AD username and password fields immediately. In the background it starts a PingOne `pi.flow` authorization request with PKCE. When PingOne returns a short-lived flow, the Sign in button becomes available. The browser sends entered credentials directly to PingOne; the assigned policy can authenticate against AD through the LDAP gateway and enforce MFA. The password is not stored in browser storage or sent to GitHub Pages. After login, the app reads PingOne UserInfo to populate the profile. After logout or an error, a retry link remains available.

No real money or banking API is involved. A successful OIDC login alone does not prove that a fresh MFA challenge occurred; verify policy execution in PingOne authentication logs.

## Run locally

Requirements: a current browser and Python 3 (or any static HTTP server). No package install or build step.

```sh
python3 -m http.server 8080
```

Visit `http://localhost:8080/`. For local PingOne testing, register that exact redirect and post-logout URL, and allow `http://localhost:8080` as a browser origin. The hosted preview's URL needs separate entries. Run `npm test` to check the authentication validation logic; Node.js 20+ is required for tests.

## Deploy with GitHub Pages

In the repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. The `Deploy banking app` workflow runs on pushes to `main` or can be started manually from **Actions**. It checks the application and publishes `index.html`, `style.css`, `app.js`, `signon.html`, `signon.css`, and `signon.js`.

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
5. On the gateway's **Lookup → User Types** tab, add a user type. Set **Password Authority** to **LDAP**, set the AD user search base DN and a unique link attribute such as `sAMAccountName`, and select the PingOne population and attribute mappings needed for OIDC profile claims. Map AD `telephoneNumber` to PingOne's primary/work phone attribute and map AD address attributes such as `streetAddress`, `l`, `st`, `postalCode`, and `co` to the corresponding PingOne address fields if you want those values shown on the North Bank profile. Leave **Enable password changes from PingOne** off for this authentication-only setup. Enable migration on first authentication if the test user does not already have a linked PingOne record. That creates a PingOne identity record; it does not write to AD.
6. Create an authentication policy with a Login step that selects this gateway and user type under **Migrate Gateway Users Upon First Authentication**. Add a PingOne MFA step with the desired factors and enrollment behavior, then assign the policy to the OIDC application. Check that your PingOne tenant has both the primary authentication and MFA capabilities needed for this flow.
7. The hosted app already has the North Bank sandbox issuer and public application client ID. For another environment, use the app's **PingOne setup** page to override these values with that environment's regional issuer URL from OIDC discovery and its public application client ID. Never enter a client secret or LDAP bind password into the app.
8. Open the app with a test AD user. Test both the correct and an incorrect AD password. Check the sign-in events for gateway lookup, AD credential validation, and MFA, then confirm the profile claims are mapped correctly.

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

1. Confirm the relevant AD address attributes are populated for the user. Common attributes include `streetAddress`, `l` (city), `st` (state or province), `postalCode`, and `co` (country).
2. In the LDAP gateway user type's **Map Attributes** section, map those AD values to PingOne address fields. For an existing PingOne user, enable **Update PingOne user attributes as users sign on** and save, then sign in again to refresh the record.
3. In **North Bank Web CIAM → Resources**, allow the OIDC **address** scope. If the app overrides its OIDC attribute mapping, make sure it returns the standard `address` claim.
4. Check the user's PingOne directory address, then sign out and sign in again. If the field is still empty, inspect the UserInfo `address` claim. The page does not read AD directly.

## Authentication design

The browser uses OIDC Authorization Code with S256 PKCE and PingOne's non-redirect `pi.flow` response mode. It exchanges the resulting authorization code, verifies the RS256 ID token against PingOne JWKS, checks issuer, audience, authorized party, nonce, issue and expiry times, and matches the UserInfo `sub` to the ID token. Redirect callbacks, if used, also validate `state`. Tokens remain in memory and disappear on reload. The short-lived PKCE transaction is in `sessionStorage` and is removed when the code is redeemed. Public issuer/client ID settings are stored in `localStorage` for convenience.

The issuer allowlist covers several standard PingOne regional hosts. If your tenant uses another supported host, review and update `validateIssuer()` and endpoint checks before testing. The code expects RS256; configure the application accordingly. The user session ends at ID token expiry; there is no refresh-token flow.

This is a client-side identity demonstration. A real banking system needs server-side token validation, authorization for every operation, a real ledger, and transaction-specific controls. The **Simulate transfer** action does not invoke PingOne MFA step-up or a payment service.

## Project files

| Path | Purpose |
| --- | --- |
| `index.html` | Accessible page shell |
| `style.css` | Responsive interface |
| `app.js` | UI, sample data, PingOne OIDC flow |
| `signon.html`, `signon.css`, `signon.js` | Main-page PingOne flow form and legacy sign-on URL handler |
| `tests/auth.test.cjs` | Token, issuer, and CSV security checks |
| `.github/workflows/checks.yml` | CI syntax and test checks |
| `.github/workflows/pages.yml` | GitHub Pages deployment |

## Validation checklist

Test valid AD login, bad AD password, MFA cancel/deny, gateway outage, redirect mismatch, logout, and expiry. Verify the correct PingOne policy is assigned to the app. If an existing SSO session skips a challenge, inspect the policy and session settings before drawing conclusions about MFA.

Official references: [PingOne SPA configuration](https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---single-page-app.html), [LDAP gateway setup](https://docs.pingidentity.com/pingone/integrations/p1_gateways_overview.html), [LDAP user type and password authority](https://docs.pingidentity.com/pingone/integrations/p1_add_a_user_type.html), and [gateway authentication policy](https://docs.pingidentity.com/pingone/integrations/p1_create_auth_policy_using_the_gateway.html).
