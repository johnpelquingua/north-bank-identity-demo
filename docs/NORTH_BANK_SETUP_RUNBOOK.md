# North Bank identity demo setup guide

**Version:** 13 October 2026  
**Audience:** Someone rebuilding the North Bank proof of concept from a new Windows Server 2022 VM  
**Scope:** Active Directory, a separate PingOne LDAP Gateway host, PingOne Customer sign in and MFA, the North Bank website, Supabase fictional transfers, and the prepared PingOne Recognize face check

This is a build and verification guide for a **fictional banking demonstration**. It explains the order in which the pieces must be configured and gives a result to check before moving to the next stage. The website is public, but its accounts and transfers represent fictional balances only. Do not enter real customer records, bank account data, or live payment credentials.

The existing sandbox uses a Windows Server 2022 domain named `ad.lab.test`. Its LDAP Gateway runs on a separate machine. The original VM provider, network addresses, hostnames, and gateway operating system were not recorded; the fields marked **record your value** must be filled in from your own environment. Console labels may move as vendors update their interfaces; the linked vendor pages at the end are the authority if a menu has changed.

## 1  Understand what you are building

The browser downloads the North Bank website from GitHub Pages. It sends the username and password directly to PingOne. PingOne asks the separate LDAP Gateway to look up the account and validate the password with Active Directory. PingOne then handles MFA and issues an OpenID Connect token. The website uses that token to call the `bank-demo` Supabase Edge Function. That function checks the token and uses PostgreSQL functions to update fictional balances and history. PingOne Recognize is a separate, **prepared but inactive** face check for selected transfers.

The simple architecture picture supplied with this guide shows those relationships. A transfer is not an LDAP call: after sign in, the website sends it to Supabase. AD is the password authority; Supabase is the fictional ledger. [Sources: PingOne LDAP gateway overview; repository files `app.js`, `banking.js`, and `supabase/functions/bank-demo/index.mjs`.]

## 2  Record values before you start

Create a private worksheet or password manager entry. Record the following as you create them. **Do not put passwords, gateway credentials, private keys, or Supabase secret keys in this guide or in GitHub.**

| Item | Existing North Bank sandbox or value to record |
| --- | --- |
| AD domain and base DN | `ad.lab.test`; base DN `DC=ad,DC=lab,DC=test` |
| AD server name and private IP | **Record your value**; example `dc01.ad.lab.test` |
| VM provider, subnet, and firewall rules | **Record your value** |
| Separate LDAP Gateway host and OS | **Record your value** |
| Test user names and OU DN | **Record your value** |
| LDAP bind account DN | **Record your value**; keep its password in a password manager |
| PingOne environment ID | `22f37616-5cf6-47ee-8111-f0c870cbfa8f` |
| PingOne issuer | `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as` |
| North Bank public client ID | `b62c72a0-1d23-4351-8f67-77054a795169` |
| PingOne gateway name, user type, population | **Record your values** |
| Authentication policy | `North_Bank_AD_Login` in the existing sandbox |
| MFA policy | `North_Bank_Authenticator` in the existing sandbox |
| Website | `https://johnpelquingua.github.io/north-bank-identity-demo/` |
| Supabase project URL | `https://uxjyitgzrtxgftcpzoxk.supabase.co` |
| Recognize sandbox customer | `netpoleons_asia` |

If you are rebuilding **a new tenant or project**, replace the existing sandbox values throughout the code and console configuration. The issuer, client ID, Supabase URL, allowed website origin, FIDO relying party ID, and Recognize URLs are coupled to this deployment; changing only the visible website address is insufficient.

## 3  Create the Windows Server 2022 AD VM

### 3.1  Create and connect to the VM

1. In your VM platform, create a Windows Server 2022 virtual machine. Give it enough CPU, memory, and disk for an AD lab and select a private network reachable by the separate gateway host. The exact VM size and provider are environment choices, not recorded project settings.
2. Set a strong local Administrator password and store it privately. Use the provider's console or Remote Desktop to sign in.
3. In Windows, open **Server Manager → Local Server**. Rename the computer to a memorable name such as `DC01`; restart when asked. Record the actual name.
4. Assign a stable **private** IP address and subnet. Configure the VM's preferred DNS to use its own private address after DNS is installed. Record the IP, gateway, and DNS values. Avoid putting the domain controller directly on the public internet.
5. Confirm the gateway host can route to the AD VM. Allow LDAP over TLS on TCP **636** only from the gateway host or trusted private network; allow any management ports only from your administration network. The gateway also needs outbound TLS/WebSocket access to the PingOne Singapore hosts listed in PingOne's gateway prerequisites.

**Check:** In Server Manager, the computer name and private IP match your worksheet. From the future gateway host, `Test-NetConnection <AD_HOSTNAME_OR_IP> -Port 636` should succeed *after* you complete the certificate step below. Do not treat a failed test before then as a finished setup.

### 3.2  Install Active Directory Domain Services and DNS

1. In **Server Manager**, choose **Manage → Add Roles and Features**.
2. Choose **Role-based or feature-based installation** and select this server.
3. Select **Active Directory Domain Services**. Accept the management tools offered by the wizard. Select **DNS Server** too if it was not added automatically. Complete **Install**.
4. When installation finishes, click the notification flag in Server Manager and choose **Promote this server to a domain controller**.
5. For a new lab choose **Add a new forest**, then enter `ad.lab.test` as the root domain name. If you already have a domain, do not create a second forest; join it using your organization's procedure.
6. On **Domain Controller Options**, keep DNS and Global Catalog selected. Set and securely save the Directory Services Restore Mode password. Continue through DNS, NetBIOS, paths, and prerequisites. Note any warning that requires action; then click **Install**. The VM restarts.
7. Sign in as a domain administrator. Open **Server Manager → Tools → Active Directory Users and Computers** and confirm that `ad.lab.test` appears. Open **Tools → DNS** and confirm the domain zone exists.

**Check:** On the domain controller, `Get-ADDomain` should report `ad.lab.test`. `Resolve-DnsName ad.lab.test` should resolve. If either fails, fix AD or DNS before installing the gateway. Microsoft documents both the GUI and PowerShell installation methods in its AD DS deployment guide.

### 3.3  Create test users and a read-only gateway account

1. Open **Active Directory Users and Computers**. Under `ad.lab.test`, create an OU for test customers and an OU for service accounts. Record their distinguished names. A simple example is `OU=BankCustomers,DC=ad,DC=lab,DC=test`; use your actual OU name if different.
2. In the customer OU, create at least **two** enabled test users. Give each a unique `sAMAccountName`, a password known only to the tester, and a valid email address. Two users are necessary to verify transfers between separate accounts.
3. Open each user's **Properties** and populate **E-mail**, and optionally telephone and address values. These source attributes only appear in North Bank after the gateway and PingOne claim mappings are configured.
4. In the service account OU, create a dedicated account for the LDAP Gateway to search users. Grant it only the directory read access it needs. Record its bind DN and password privately. Do not use a Domain Admin account for routine LDAP lookup.
5. Use **Attribute Editor** or an LDAP inspection tool to confirm the actual user search base and `sAMAccountName` values. If Attribute Editor is missing, enable **View → Advanced Features**.

**Check:** Both test accounts are enabled and have distinct usernames. The gateway bind account can read their attributes but is not privileged to administer the domain. PingOne's service-account instructions describe the required lookup rights.

### 3.4  Enable trusted LDAPS

1. Obtain a server-authentication certificate for the domain controller from a CA trusted by the gateway machine. For a private lab, a private CA can be used if its issuing certificate is installed as trusted on the gateway host. The certificate must contain the domain controller's fully qualified name, such as `dc01.ad.lab.test`.
2. Install the certificate in the domain controller's appropriate computer or NTDS certificate store. Follow Microsoft's LDAPS certificate requirements for key usage, subject name, and trust chain. Do not bypass certificate validation as a permanent fix.
3. Confirm the LDAP service listens on TCP 636 and that the gateway host trusts the issuing CA. On the gateway host, run `Test-NetConnection dc01.ad.lab.test -Port 636`, replacing the name. A successful TCP test only proves reachability; also test a TLS LDAP bind with a trusted LDAP client or with the gateway's connection check.

**Check:** The gateway host resolves the AD server name, connects on 636, and accepts the certificate chain. If the certificate name does not match the host name entered in PingOne, correct it before continuing.

## 4  Set up the separate PingOne LDAP Gateway host

The gateway is **outside the AD VM** in this build. It can be a separate Windows or Linux machine or a Docker host. This guide uses the PingOne-supported **Windows service** path for clear repeatable steps; if your separate machine uses Linux, follow PingOne's Docker or standalone Java instructions linked at the end. Do not install it on the domain controller just because the example below uses Windows.

1. Create the separate host on a network that can reach the AD server on TCP 636. Confirm outbound access to the PingOne Singapore gateway WebSocket addresses, `auth.pingone.sg`, and `api.pingone.sg`. PingOne's gateway prerequisites specify the current host list and minimum resources; review them rather than hard-coding an old list into firewall policy.
2. If using the Windows service package, install **Java 21 LTS or 25 LTS** as required by the current PingOne gateway instructions. Set the system `JAVA_HOME` variable to the Java installation directory, then start a new terminal and verify `java -version`.
3. In the PingOne admin console, select the intended **Customer** environment. Go to **Integrations → Gateways**, click the add icon, name the gateway (for example, `North Bank AD Gateway`), and choose **LDAP**.
4. Choose **Microsoft Active Directory**. Enter the domain controller's **hostname**, port **636**, and **TLS**. Enter the bind account DN and password from your private worksheet. Prefer the real server hostname over a load balancer name. Save.
5. Copy the generated **gateway credential** to the password manager when PingOne displays it. This is a secret, and PingOne may not show the same value again.
6. Open the gateway's **Download** tab and download its standalone package to the **separate gateway host**. Extract it to a stable folder, such as `C:\Program Files\Ping Identity\pingone-ldap-gateway-<version>`. Keep the extracted versioned directory name.
7. Read the package's `README.txt`. In its `config\run.properties`, put the gateway credential and any proxy configuration exactly as that version's README describes. Do not guess property names from an old version. On Windows, follow its `bin\windows` service-install instructions and start **PingOne LDAP Gateway** in the Services app.
8. Back in PingOne, open the gateway details and verify its instance is **connected/healthy**. If it is offline, check the service log and outbound WebSocket access, then LDAPS trust and bind credentials.

**Check:** The service is running on the separate host and PingOne shows an active instance. The gateway can search AD. An active service alone does not prove a successful LDAP bind.

### 4.1  Add the gateway user type

1. In **Integrations → Gateways**, open your gateway and choose **Lookup → User Types → Add**. Enter a clear label such as `North Bank AD Users`.
2. Set **Select Password Authority** to **LDAP**. This keeps the password check in AD on every sign in. Do not choose PingOne if you intend AD to remain the password authority.
3. Enter the actual search base DN from section 3, for example `OU=BankCustomers,DC=ad,DC=lab,DC=test`. Use `sAMAccountName` as the username match/link attribute if that is how your test users sign in. Select the PingOne population for customers.
4. Enable **migration of new users upon first authentication** so the first successful AD sign in creates a linked PingOne record. This does not copy the password into PingOne when LDAP remains the password authority.
5. Map the attributes needed by the app: AD `mail` to PingOne email; given name and surname to profile name; `telephoneNumber` to a PingOne phone attribute; and `streetAddress`, `l`, `st`, `postalCode`, `c` to the relevant PingOne address attributes. Leave **password changes from PingOne** off for this authentication-only example.
6. Save. If you change mappings after a user has already migrated, enable **Update PingOne user attributes as users sign on** where appropriate, then sign in again and inspect the resulting PingOne profile.

**Check:** A lookup for a test username finds exactly one AD identity, and the populated PingOne record belongs to the same user. Verify email before trying email MFA.

## 5  Configure PingOne sign in for North Bank

### 5.0  Create or select the PingOne environment

1. Sign in to the PingOne admin console with an account permitted to manage environments. If rebuilding inside the existing sandbox, select its current Customer environment and **do not create a duplicate**.
2. For a new build, open the **Environments** page from the Ping Identity logo and click **Add**. Name the environment, choose **Customer** as the use case and **Sandbox** as its type, and select a license your organization actually has. Include the **PingOne MFA** capability and the identity services required for primary authentication. Save and wait for the environment to finish provisioning.
3. Open the new environment. Record its environment ID, regional issuer, API region, and an administrator who can configure gateways, applications, and policies. If the required capability is absent or a menu is unavailable, resolve licensing and role access before proceeding.
4. Create or select a customer **population** for users imported from AD on first login. Record its name. This is the population you will choose in the gateway user type; it does not create AD accounts.

**Check:** The intended Customer environment is selected, and you can open **Integrations → Gateways**, **Applications**, and **Authentication**. The existing North Bank code is pinned to the Singapore sandbox issuer and client ID in the worksheet; a new environment needs those public values changed in the app and Edge Function.

### 5.1  Create or inspect the application

1. In the same PingOne environment, go to **Applications → Applications → Add Application**. Choose **OIDC Single Page App**. Name it `North Bank Web CIAM` and enable it.
2. In configuration, choose **Authorization Code** with response type `code`, **PKCE S256 required**, **token endpoint authentication NONE**, and **RS256** ID token signing. This public browser application must not have a client secret embedded in the website.
3. Add the exact **Redirect URI** `https://johnpelquingua.github.io/north-bank-identity-demo/` and the same **Post Logout Redirect URI**. If a Signon URL is requested, use `https://johnpelquingua.github.io/north-bank-identity-demo/signon.html`; the current app uses its inline form and ordinarily stays on the main page.
4. Set **CORS / allowed browser origin** to `https://johnpelquingua.github.io`. This is the origin only, without the repository path. The browser also calls the regional PingOne API host, so ensure the environment's relevant CORS settings allow this origin.
5. Under **Resources**, allow `openid`, `profile`, `email`, `phone`, `address`, plus `p1:read:device`, `p1:create:device`, `p1:update:device`, and `p1:update:userMfaEnabled`. These are the scopes the code requests. Save and copy the public client ID.
6. Confirm the issuer in the environment's OIDC discovery is `https://auth.pingone.sg/22f37616-5cf6-47ee-8111-f0c870cbfa8f/as` for this sandbox. A new environment has a different ID and possibly a different regional host.

**Check:** Open the issuer plus `/.well-known/openid-configuration` in a browser. It returns JSON with matching issuer, authorization, token, UserInfo, and JWKS endpoints. Never edit the project to use a guessed issuer.

### 5.2  Create and assign the authentication policy

1. Go to **Authentication → Authentication**. Create a policy named `North_Bank_AD_Login` or open the existing one.
2. Add a **Login** step. In **Migrate Gateway Users Upon First Authentication**, add the LDAP gateway and user type you created. This directs first-time users to AD and links their PingOne accounts.
3. Add a **Multi-Factor Authentication** step after Login. Select `North_Bank_Authenticator` (created in section 6) or use the environment's default MFA policy if you deliberately made it the default.
4. For users with **no enrolled or compatible method**, choose the policy behavior used by this demo: **Bypass**. This lets North Bank's own first-sign-in enrollment page appear after password authentication. Save the policy.
5. In **Applications → Applications → North Bank Web CIAM → Policies**, assign `North_Bank_AD_Login` to the application. Check that this is the active policy, not merely one that exists in the environment.

**Check:** Sign in as a new test AD user. A wrong AD password must fail. A correct password must advance through the configured flow; the PingOne authentication log should show the gateway Login step. **Security boundary:** Bypass issues a token after password-only authentication for a user with no method. The current browser hides its dashboard until enrollment, but a production service must enforce this on its server before granting banking access.

## 6  Configure and test MFA

### 6.1  Make the MFA policy

1. Go to **Authentication → MFA Policies** and create or edit `North_Bank_Authenticator`. Enable **Authenticator App (TOTP)** and **Allow Pairing**.
2. Enable **Email** and **Allow Pairing** only after the test user's AD `mail` value is mapped into PingOne and PingOne can deliver an email code.
3. For passkeys, first create or edit a policy under **Authentication → FIDO**. Set its relying party ID to `johnpelquingua.github.io` for the hosted site, and allow the platform and security-key authenticators you want. Then enable **FIDO2** and pairing in `North_Bank_Authenticator` and select that FIDO policy.
4. Save. If North Bank's in-app device enrollment is using the environment's default MFA policy, make this policy the default. Record which policy the sign-in flow actually uses so future changes are applied to the right policy.
5. In the authentication policy, confirm its MFA step selects this policy. A policy with methods enabled but not assigned to the sign-in flow will not challenge anyone.

**Check:** PingOne's MFA policy page shows TOTP, Email, and FIDO2 as intended. The FIDO relying party ID matches the website hostname. A new custom domain will need a new matching FIDO setup and passkey enrollment.

### 6.2  First sign in and QR enrollment

1. Open the public website in a **private browser window**. Enter one AD test username and password. PingOne validates these through the LDAP Gateway.
2. If this user has no enrolled method, North Bank asks for one. Choose **Authenticator app**. Scan the displayed QR code with a TOTP app. If the QR code cannot render, open **Use setup key instead** and enter the key manually. Keep the key private.
3. Enter the current six-digit authenticator code and choose **Verify and link method** before the setup key expires.
4. Sign out and start a fresh login. After the AD password, PingOne should request the authenticator code. Use the code from the same app.
5. Open **My profile → Sign-in methods**. Confirm TOTP appears under enrolled methods and is removed from **Add a method**. Add email and passkey if desired. Each method is attached to the **signed-in PingOne user**, so test user B should have a different set of methods.

**Check:** In PingOne logs, the second login includes an MFA challenge and success event. Seeing an enrolled device is not proof that a particular login challenged it. If an existing SSO session interferes, use a fresh private window and inspect policy/session settings.

### 6.3  Set a three-attempt MFA account lockout

1. In the North Bank PingOne environment, open **Authentication → MFA Settings**.
2. Under **Account lockout**, select **Lock account after** and enter **3** failed attempts.
3. Select **Unlock accounts that were locked by failed MFA attempts after**, enter **30** seconds, and save. This is an environment-wide setting, so check its effect on other applications in that environment.
4. Keep device-level failed-attempt limits in the MFA policy aligned with this account limit. The account limit counts failed MFA authorization actions across registered devices; changing from TOTP to email or passkey does not start a fresh account counter. A cancelled browser passkey prompt has not been submitted to PingOne and should not count.
5. Test with a disposable user: submit a wrong TOTP once, a wrong email code once, then a wrong code once more. Confirm PingOne reports the account as locked and rejects a fresh sign-in with any method. Check its authentication events. Do not use a production user for this test.
6. To recover early, go to **Directory → Users**, find the account, and unlock it with the account toggle. If a method is separately locked, open the user's **Services → Authentication → Methods**, use the affected method's menu, and select **Unlock**. Otherwise, wait for the 30-second account lock to expire.

If PingOne ends the sign-in after three wrong checks but the same user can immediately authenticate in a new flow, the account is not locked. Confirm the MFA Settings were saved in the same environment, then inspect the **MFA policy actually assigned to North Bank**. Under **User Access Configuration**, **Skip account lockout verification** must be off; when enabled, PingOne applies the policy even to a locked user. Check the affected user's account and method status in **Directory → Users** and compare the three failures with PingOne authentication events. The website cannot turn a terminated flow into an account-wide lock.

The login page warns **up to 2** attempts remain after one failed MFA check it observed and **up to 1** after two. PingOne is the source of truth for the account counter; the browser cannot see failed attempts from another browser or an earlier flow. Wrong AD passwords use the AD/password authority lockout policy and are separate from this MFA setting.

## 7  Publish the North Bank website

1. Fork or copy the `johnpelquingua/north-bank-identity-demo` repository to your GitHub account. The site is static; no web server build is required. The source is visible in a public repository.
2. In the repository, open **Settings → Pages**. Under **Build and deployment → Source**, select **GitHub Actions**. The existing `.github/workflows/pages.yml` checks JavaScript, runs tests, and publishes the site on pushes to `main`.
3. Open **Actions** and verify **Deploy banking app** succeeds. Then open the Pages URL and confirm the login form loads and does not show a missing-file or JavaScript error.
4. If you use the existing repository, its URL is `https://johnpelquingua.github.io/north-bank-identity-demo/`. If you use another repository owner, repository name, or custom domain, update the redirect, logout URL, CORS origin, FIDO relying party ID, Supabase function allowed origins, and the app's configured URL values before sign-in testing.
5. For a local smoke test, start a static HTTP server from the repository folder and visit `http://localhost:8080/`. Local PingOne sign-in requires that **exact** local redirect/logout URI and `http://localhost:8080` allowed origin in the PingOne application. A file opened directly as `file:///` is not an equivalent test.

**Check:** A fresh private browser sign-in opens the same app after MFA, and **My profile** shows that AD user's mapped name, email, phone, and address where configured. The website does not read AD directly.

## 8  Set up shared fictional transfers in Supabase

### 8.1  Create the project and database schema

1. Create a Supabase project. Record its **Project URL** and **project reference**. For the existing sandbox they are `https://uxjyitgzrtxgftcpzoxk.supabase.co` and `uxjyitgzrtxgftcpzoxk`.
2. In the Supabase dashboard choose **SQL Editor → New query**. Open `supabase/migrations/202610130001_bank_demo.sql` from the repository, copy its **entire** contents, paste them, and click **Run**. Wait for a success result. Do not run only the highlighted ending lines.
3. In **Database → Table Editor**, confirm `demo_accounts` and `demo_transfers` exist. The script also creates a sequence and PostgreSQL functions, restricts public access, and grants the Edge Function's service role the necessary operations.
4. Check that the Supabase URL in `banking.js` points to your project. In the existing sandbox it already points to `https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/bank-demo`. If you created a new project, change this public URL before publishing the site.

**Check:** The SQL Editor reports success. An account is created for each new PingOne subject at first API access, with a fictional opening balance of **PHP 100,000**. The account number is generated separately for each user. Do not expose the Supabase service role or secret key in website files.

### 8.2  Deploy the `bank-demo` Edge Function

**Recommended reproducible path, Supabase CLI:** Open PowerShell in the repository root. Install the Supabase CLI using the current official instructions, then run `supabase login` and `supabase link --project-ref uxjyitgzrtxgftcpzoxk`. Replace the project reference for a new project. The included `supabase/config.toml` selects `supabase/functions/bank-demo/index.mjs`.

**Dashboard path:** In **Edge Functions → Deploy a new function → Via Editor**, name it exactly `bank-demo`, replace the template code with the repository's function code, add the companion `recognize.mjs` file if using the current function version, and click **Deploy function**. In **bank-demo → Settings**, leave **Verify JWT with legacy secret** **off**. The browser sends a PingOne ID token, not a Supabase JWT; the Edge Function checks PingOne issuer, audience, signature, and expiration itself. CLI deployment is less error-prone for this multi-file function.

**For a fresh rebuild using the current repository:** Run the second SQL migration from section 9.3 **now**, then deploy the current `bank-demo` code with `supabase functions deploy bank-demo --no-verify-jwt`. Keep `RECOGNIZE_ENABLED` unset. Transfers that do not need a face check can work; face-required transfers will stop safely with a “not ready” message until Recognize is activated. This current function requires the second migration's six-argument transfer RPC. **For the existing live sandbox:** Its earlier function is already serving working transfers; leave it in place until Ping confirms the Recognize setting, then update the SQL and function together in section 9.3. Deploying current code against only the first migration can break transfers.

**Check:** Sign in as test users A and B in separate browsers. Copy A's ten-digit account number. From B, send a small fictional transfer such as PHP 100. Confirm B's balance decreases, A's increases, and both transaction histories show the same event in the appropriate direction. Retry behavior uses a request ID to avoid duplicate debits. No real money moves.

## 9  Prepare PingOne Recognize face verification

**Current state:** The `recognize-jwks` public endpoint works and the required Supabase secret names exist. The Recognize tenant's **RemoteJWKSet** user authorization setting is still awaiting Ping/Keyless staff confirmation. `RECOGNIZE_ENABLED` must stay **unset** until that confirmation and the paired database/function deployment. Ordinary working transfers can continue on the existing live version meanwhile.

The prepared rule is: a transfer **above PHP 20,000** requires a face check; the **first PHP 20,000** transfer is allowed; another PHP 20,000 transfer by the same sender within **10 minutes** requires a check; an amount below PHP 20,000 does not trigger it. The PostgreSQL migration enforces the rule after locking the sender's account. The verified Recognize proof is tied to the exact sender, recipient account, amount, and request ID.

### 9.1  Locate public tenant settings

1. Sign in to the **PingOne Recognize** sandbox dashboard. Under **Access Control**, record **Customer Name** `netpoleons_asia`.
2. Copy the **Authentication Service** link: `https://authentication-service-sandbox.eks.core-production.keyless.technology/`.
3. The public Recognize signing keys are at `https://operations-service-sandbox.eks.core-production.keyless.technology/customers/netpoleons_asia/.well-known/jwks.json`. Opening this exact path should show a JSON `keys` array. The root service URLs can return an error; this does not mean the service is down.
4. Do not copy the dashboard's Mobile API Key or Secret API Key into this browser application. The Web SDK path prepared in the project does not need those keys in the page.

### 9.2  Create a private signing key and public JWKS endpoint

1. In PowerShell, change to the repository folder and run `node scripts/create-recognize-key.mjs`. It prints `RECOGNIZE_AUTH_KEY_ID` and `RECOGNIZE_AUTH_PRIVATE_JWK` values. Do not paste either value into chat, email, GitHub, or this document.
2. In Supabase **Edge Functions → Secrets**, enter each name and its complete value, then **Save**. Add `RECOGNIZE_CUSTOMER_NAME` = `netpoleons_asia`; `RECOGNIZE_AUTH_SERVICE_URL` = the Authentication Service URL above; and `RECOGNIZE_JWKS_URL` = the operations JWKS URL above. Confirm all five **names** appear under Custom secrets. Supabase hides the secret values after saving.
3. Deploy the repository's `supabase/functions/recognize-jwks/index.mjs` as an Edge Function named **`recognize-jwks`**. With CLI, run `supabase functions deploy recognize-jwks --no-verify-jwt`. In its Settings page, keep **Verify JWT with legacy secret** off because Ping/Keyless staff must be able to fetch its public key without a Supabase token.
4. Open `https://uxjyitgzrtxgftcpzoxk.supabase.co/functions/v1/recognize-jwks`. It should show JSON with a public `keys` array, and no private `d` value. If it says **Public key is not configured**, recheck the two signing-key secret **names** and values in Supabase, then refresh.
5. Ask Ping/Keyless staff to set **User Authorization Type** to `RemoteJWKSet` and **User Authorization JWKs URI** to that public `recognize-jwks` URL for `netpoleons_asia`. Ping's Recognize documentation states that this customer setting must be changed by its staff. Keep their confirmation with the project records.

### 9.3  Activate only after Ping confirms

1. For the **existing live sandbox**, arrange a brief transfer maintenance window. The database migration replaces the old transfer function signature, so transfers can pause until the new Edge Function is deployed. For a **fresh rebuild** that already completed section 8.2 using the current code, these paired actions are done; verify them instead of repeating them.
2. On the existing live sandbox, run the **entire** `supabase/migrations/202610130002_recognize_step_up.sql` in Supabase SQL Editor. Confirm success.
3. On the existing live sandbox, deploy the current multi-file `bank-demo` function, including both `index.mjs` and `recognize.mjs`, preferably using `supabase functions deploy bank-demo --no-verify-jwt`. Verify the function settings still have legacy JWT verification **off**.
4. Only after the RemoteJWKSet setting is confirmed, the migration has succeeded, and the matching function is live, add `RECOGNIZE_ENABLED` = `true` to Supabase Edge Function Secrets. Supabase applies function secrets without redeployment according to its current documentation.
5. With two test AD users, try: PHP 19,999; a first PHP 20,000; a second PHP 20,000 within 10 minutes; and PHP 20,001. For the required cases, complete first-time face enrollment and then a separate authentication. Cancel one face check and verify no balance or history changes. Retry a successful request and verify it is not debited twice.

**Check:** Recognize's success result is validated by the Edge Function against the tenant's public keys; the browser cannot simply mark a face check as passed. No face image is stored in Supabase by this project. This is still a fictional transfer demo, not a production payment authorization system.

## 10  End-to-end acceptance checklist

1. **AD:** Both test users exist and are enabled in `ad.lab.test`; incorrect passwords fail.
2. **LDAPS and gateway:** The separate gateway host connects to AD over trusted TLS and appears healthy in PingOne.
3. **PingOne application:** The public client ID, issuer, redirect, CORS origin, and assigned authentication policy match the deployed website.
4. **First sign in:** A new AD user signs in and enrolls TOTP with QR or setup key; the next fresh sign in prompts MFA.
5. **Per-user methods:** User A's enrolled methods and preferences do not appear for user B. Email and passkey work only after their policies and source attributes are configured.
6. **Profile:** Name and email, and optionally phone/address, match PingOne UserInfo after AD mapping.
7. **Transfers:** Two users see their own fictional account numbers, distinct balances, and matching transfer history. Bad recipient, same-account transfer, insufficient balance, and duplicate requests fail safely.
8. **Recognize:** Leave inactive until section 9.3 is completed. After activation, test each PHP 20,000 rule branch and a canceled check.
9. **Logs:** Review PingOne authentication events for the gateway and MFA, Supabase Edge Function logs for transfer errors, and the browser's Network tab for CORS or redirect problems.

## 11  Troubleshooting by symptom

| Symptom | Check first |
| --- | --- |
| Website shows an old UI | In GitHub **Actions**, confirm the latest Pages workflow succeeded and the deployed commit contains the change. Then try a private window. A new browser that still shows old UI points to deployment rather than cache. |
| Login fails before asking for password | Verify issuer discovery, application client ID, exact redirect URI, and CORS origin; inspect the browser Network request to PingOne. |
| Every MFA method fails | Start a fresh private-window sign in. Check the policy assigned to the app, the selected MFA policy, registered devices, and PingOne event details. |
| LDAP gateway is offline | Check the separate host's service, its gateway credential, outbound PingOne WebSocket access, DNS, and proxy settings. |
| AD user is not found | Check the user search base DN, `sAMAccountName`, the bind account's read rights, and migration-on-first-authentication setting. |
| LDAPS connection fails | Check TCP 636, the certificate's server name and trust chain, and that PingOne is configured for TLS to the same hostname. |
| Profile email, phone, or address is blank | Check the AD source attributes, gateway mapping, refresh-on-sign-in, OIDC scopes, and PingOne UserInfo response. |
| Transfer service fails | Check both migration versions versus the deployed function version, the Supabase project URL, function logs, and whether legacy JWT verification is off. |
| `recognize-jwks` says public key is not configured | Check `RECOGNIZE_AUTH_KEY_ID` and `RECOGNIZE_AUTH_PRIVATE_JWK` in Supabase Secrets; never paste the private JWK into a ticket. |
| Face prompt says not ready | Keep `RECOGNIZE_ENABLED` unset until Ping confirms RemoteJWKSet and the matching SQL/function deployment is complete. |

## 12  Official references and project files

**Microsoft:** [Install AD DS on Windows Server](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/deploy/install-active-directory-domain-services--level-100-) and [enable LDAPS with a trusted certificate](https://learn.microsoft.com/en-us/troubleshoot/windows-server/identity/enable-ldap-over-ssl-3rd-certification-authority).

**PingOne:** [Add a Customer environment](https://docs.pingidentity.com/pingone/settings/p1_addenvironment.html), [LDAP Gateway prerequisites](https://docs.pingidentity.com/pingone/integrations/p1_gateway_prereqs.html), [add an LDAP gateway](https://docs.pingidentity.com/pingone/integrations/p1_add_ldap_gateway.html), [run it as a Windows service](https://docs.pingidentity.com/pingone/integrations/p1_run_gateway_windows_service.html), [add a user type](https://docs.pingidentity.com/pingone/integrations/p1_add_a_user_type.html), [gateway authentication policy](https://docs.pingidentity.com/pingone/integrations/p1_create_auth_policy_using_the_gateway.html), [MFA policies](https://docs.pingidentity.com/pingone/authentication/p1_mfa_policies.html), [FIDO policies](https://docs.pingidentity.com/pingone/authentication/p1_fido_policies.html), and [Recognize user authorization](https://docs.pingidentity.com/recognize/web-sdk/web-sdk-reference-user-authorization.html).

**Publishing and ledger:** [GitHub Pages with Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Supabase dashboard Edge Functions](https://supabase.com/docs/guides/functions/quickstart-dashboard), and [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

**Project source:** `README.md`; `app.js`; `banking.js`; `.github/workflows/pages.yml`; `supabase/config.toml`; `supabase/migrations/202610130001_bank_demo.sql`; `supabase/migrations/202610130002_recognize_step_up.sql`; `supabase/functions/bank-demo/index.mjs`; `supabase/functions/bank-demo/recognize.mjs`; `supabase/functions/recognize-jwks/index.mjs`; and `scripts/create-recognize-key.mjs`.
