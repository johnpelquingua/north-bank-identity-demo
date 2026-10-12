# North Bank Identity Demo

A responsive, fictional banking interface for testing **PingOne sign-in backed by Microsoft Active Directory and PingOne MFA**. It includes a login page, account overview, transaction history, profile, simulated transfers, CSV export, and an in-app setup guide.

App URL after GitHub Pages deployment: https://johnpelquingua.github.io/north-bank-identity-demo/

## Two ways to use it

- **Demo account:** Explore the interface without credentials. Balances and transfers are simulated and reset on reload. Profile changes persist only in this browser.
- **PingOne sign-in:** Register this page as an OIDC Single Page App in PingOne. A redirect sends users to PingOne, where the assigned policy can authenticate against AD through an LDAP gateway and enforce MFA. The app never receives an AD password. After login, it reads the PingOne UserInfo response to populate the profile.

No real money or banking API is involved. A successful OIDC login alone does not prove that a fresh MFA challenge occurred; verify policy execution in PingOne authentication logs.

## Run locally

Requirements: a current browser and Python 3 (or any static HTTP server). No package install or build step.

```sh
python3 -m http.server 8080
```

Visit `http://localhost:8080/`. For local PingOne testing, register that exact redirect and post-logout URL, and allow `http://localhost:8080` as a browser origin. The hosted preview's URL needs separate entries. Run `npm test` to check the authentication validation logic; Node.js 20+ is required for tests.

## Deploy with GitHub Pages

In the repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source. The `Deploy banking app` workflow runs on pushes to `main` or can be started manually from **Actions**. It checks the application and publishes only `index.html`, `style.css`, and `app.js`.

This repository is public, so GitHub Pages works with GitHub Free. The published app and repository source are visible to anyone.

For PingOne, register these values for this deployment:

| Setting | Value |
| --- | --- |
| Redirect URI | `https://johnpelquingua.github.io/north-bank-identity-demo/` |
| Post-logout redirect URI | `https://johnpelquingua.github.io/north-bank-identity-demo/` |
| Allowed browser origin | `https://johnpelquingua.github.io` |

Enter your PingOne issuer and public application client ID in the app. The browser uses a hosted identity provider for sign-in; no server secrets are needed by GitHub Pages.

## Connect PingOne to AD

**Authentication-only scope:** AD is the password authority. PingOne looks up the user through its LDAP gateway and asks AD to validate the submitted credentials; the web app only receives OIDC tokens and profile claims from PingOne. The gateway does not need to copy AD passwords into PingOne or write password or profile changes back to AD. PingOne may create a linked user record on first login so it can issue tokens and apply MFA. This record is in PingOne, not an update to AD.

1. In PingOne, create and enable an **OIDC Single Page App**. Select Authorization Code, response type `code`, token endpoint authentication `NONE`, PKCE enforcement `S256_REQUIRED`, and **RS256** ID token signing. Grant `openid profile email` scopes and map the profile claims you want to display.
2. Set the redirect URI and post-logout URI to the exact URL shown on the demo's **PingOne setup** page. Configure that page's origin in PingOne CORS settings. Keep the `localhost` and hosted URLs separate.
3. Prepare an AD test user and a directory service account with read access to the intended user search base. Configure a trusted certificate for LDAPS, and ensure the gateway host can reach the AD domain controller and PingOne.
4. Under **Integrations → Gateways**, add an **LDAP gateway** with directory type Microsoft Active Directory, AD hostname, TLS connection (typically port `636` for LDAPS), and service account Bind DN/password. Save its generated gateway credential securely. Install and start the gateway instance on a host that can reach AD and PingOne; verify its status.
5. On the gateway's **Lookup → User Types** tab, add a user type. Set **Password Authority** to **LDAP**, set the AD user search base DN and a unique link attribute such as `sAMAccountName`, and select the PingOne population and attribute mappings needed for OIDC profile claims. Leave **Enable password changes from PingOne** off for this authentication-only setup. Enable migration on first authentication if the test user does not already have a linked PingOne record. That creates a PingOne identity record; it does not write to AD.
6. Create an authentication policy with a Login step that selects this gateway and user type under **Migrate Gateway Users Upon First Authentication**. Add a PingOne MFA step with the desired factors and enrollment behavior, then assign the policy to the OIDC application. Check that your PingOne tenant has both the primary authentication and MFA capabilities needed for this flow.
7. In the app's **PingOne setup** page, enter your regional issuer URL from OIDC discovery (typically `https://auth.pingone.com/ENVIRONMENT_ID/as`) and the public application client ID. Never enter a client secret, LDAP bind password, or AD credentials into the app.
8. Sign out of demo mode and use **Sign in with PingOne** with a test AD user. Test both the correct and an incorrect AD password. Check the sign-in events for gateway lookup, AD credential validation, and MFA, then confirm the profile claims are mapped correctly.

Profile data shown by this demo is read-only after PingOne sign-in. There is no app-to-AD connection, password change, AD writeback, or general directory synchronization in this example.

## Authentication design

The browser uses OIDC Authorization Code with S256 PKCE. It validates the authorization response `state`, exchanges the code, verifies the RS256 ID token against PingOne JWKS, checks issuer, audience, authorized party, nonce, issue and expiry times, and matches the UserInfo `sub` to the ID token. Tokens remain in memory and disappear on reload. The short-lived PKCE transaction is in `sessionStorage` and is removed on callback. Public issuer/client ID settings are stored in `localStorage` for convenience.

The issuer allowlist covers several standard PingOne regional hosts. If your tenant uses another supported host, review and update `validateIssuer()` and endpoint checks before testing. The code expects RS256; configure the application accordingly. The user session ends at ID token expiry; there is no refresh-token flow.

This is a client-side identity demonstration. A real banking system needs server-side token validation, authorization for every operation, a real ledger, and transaction-specific controls. The **Simulate transfer** action does not invoke PingOne MFA step-up or a payment service.

## Project files

| Path | Purpose |
| --- | --- |
| `index.html` | Accessible page shell |
| `style.css` | Responsive interface |
| `app.js` | UI, sample data, PingOne OIDC flow |
| `tests/auth.test.cjs` | Token, issuer, and CSV security checks |
| `.github/workflows/checks.yml` | CI syntax and test checks |
| `.github/workflows/pages.yml` | GitHub Pages deployment |

## Validation checklist

Test valid AD login, bad AD password, MFA cancel/deny, gateway outage, redirect mismatch, logout, and expiry. Verify the correct PingOne policy is assigned to the app. If an existing SSO session skips a challenge, inspect the policy and session settings before drawing conclusions about MFA.

Official references: [PingOne SPA configuration](https://developer.pingidentity.com/pingone-api/platform/applications/applications-1/create-application-oidc-protocol---single-page-app.html), [LDAP gateway setup](https://docs.pingidentity.com/pingone/integrations/p1_gateways_overview.html), [LDAP user type and password authority](https://docs.pingidentity.com/pingone/integrations/p1_add_a_user_type.html), and [gateway authentication policy](https://docs.pingidentity.com/pingone/integrations/p1_create_auth_policy_using_the_gateway.html).
