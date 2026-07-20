# Changelog

## 0.2.0

**Security — read this before upgrading an internal tool.**

- **The email-domain gate now runs in the headless flows, not only on session read.** Previously
  `signUp` would create a real user in the shared "Spawn" WorkOS directory (and email them) for any
  domain, and `signInWithPassword` would seal a session cookie before anything checked policy. Both
  now deny up front, so no credential is minted and no directory write happens. `verifyEmail`
  re-checks after redeeming a token, and `requestPasswordReset` sends no mail off-domain while still
  reporting `ok` (no account enumeration).
- **Added `AUTH_REQUIRE_EMAIL_DOMAINS=true` + `assertEmailDomainGate()`.** Every Spawn app shares one
  WorkOS user pool, so an internal console whose `ALLOWED_EMAIL_DOMAINS` went missing would silently
  admit every customer of every customer-facing product. Apps that must never be world-readable now
  declare it: `isAllowedEmail` fails **closed** when a gate is required but unset, and
  `assertEmailDomainGate()` turns the misconfiguration into a failed boot instead of an open door.
- **`isAllowedEmail` rejects malformed input.** `"@allowed.com"` (empty local part) previously read
  as allowed, because splitting on `@` yielded the allowed domain. A gate must never answer "allowed"
  for something that is not an address.

Non-breaking for customer products: with no `ALLOWED_EMAIL_DOMAINS` set, behaviour is unchanged.

**Also**

- First tests (27). They cover the pending-token thread, unverified sign-in routing, the guarantee
  that no raw WorkOS string reaches a screen, and every domain-gate boundary.
- CI now runs on push and PR — previously nothing validated a commit until a release tag was cut.
- `publish.yml` runs the tests and installs with `--frozen-lockfile`.
- Working git hooks. The `prepare` script pointed at a `.githooks/` directory that did not exist, so
  no hook had ever run.
- Documented why the OAuth callback gate is enforced on read rather than at the callback: the
  address is only known after the code exchange, and authkit's `onSuccess` cannot veto a login.

## 0.1.1

Republished from a clean tree so the artifact is reproducible from source. No code change from what
0.1.0 actually shipped.

- Untracked the committed `.tgz` and ignored build/debug artifacts.

## 0.1.0 — deprecated

Do not use. Published from a dirty working tree, so the tarball contains code that exists in no
commit and cannot be rebuilt from the repository. Superseded by 0.1.1.

Initial release: headless WorkOS over one shared "Spawn" project — `IdentityGateway`, the edge-safe
policy layer, the Next.js session seam, `authProxy`, `handleCallback`, and the headless flows.
