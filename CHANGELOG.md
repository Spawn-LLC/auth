# Changelog

## 0.3.1

**Fix: the `config.matcher` recommendation from 0.3.0 does not build under Next 16.** Next requires
`config.matcher` entries to be inline string literals it can statically parse — `export const config
= authProxyConfig` (an imported object) fails the build with "the exported `config` field needs to
be a static object". 0.3.0 shipped and documented exactly that broken pattern.

- **Removed `authProxyConfig`.** It could not be used for its only purpose. Apps paste the matcher
  literal inline instead.
- **Added the `AuthMatcher` type** (`typeof AUTH_MATCHER`). Pin the inlined literal with
  `satisfies { readonly matcher: readonly [AuthMatcher] }` so `tsc` fails if the copy ever drifts
  from the shared `AUTH_MATCHER`. `AUTH_MATCHER` itself is unchanged.
- **Docs:** `proxy.ts` is now the one canonical filename (Next 16 deprecates `middleware.ts`,
  including for apps that wrap the proxy — `safeAuthProxy` is a `proxy.ts` default export too).

## 0.3.0

**Thicken the package so apps need no local auth layer or copy-pasted wiring.** Everything the apps
were reaching around for now lives here, and the docs stop recommending the unsafe matcher.

- **`AUTH_MATCHER` + `authProxyConfig` (from `@spawn-llc/auth/config`).** The one hardened
  proxy/middleware matcher, defined once instead of copy-pasted per app. It closes the "F1" bypass
  where a dynamic API segment ending in an image extension (`PATCH /api/thing/{id}.png`) escaped the
  gate. Use `export const config = authProxyConfig`. The README/IDENTITY examples previously showed a
  matcher that excluded `/api` entirely and left that bypass open — fixed.
- **`safeAuthProxy({ onUnconfigured })` (from `@spawn-llc/auth/nextjs`).** Fails **closed** when the
  WORKOS_* secrets are absent, delegating to an app-supplied fallback (redirect / 404 / next). Folds
  the three different hand-rolled "unconfigured" branches (`admin`, `landing`, `sites`) into one
  shared code path. `authProxy()` is unchanged.
- **`requireApiUser()` (from `@spawn-llc/auth/nextjs`).** The API-handler counterpart to
  `requireUser()`: returns the `User`, or a `401` JSON `NextResponse` when signed out (never a
  redirect, which a `fetch()` caller can't parse). Replaces the per-app `lib/api-auth.ts` wrappers.
- **`appPublicPaths(extra)` (from `@spawn-llc/auth/config`).** Shared defaults plus an app's in-code
  public routes, so an app with app-specific public paths (a Slack webhook, a cron tick) no longer
  needs a local config wrapper package.
- **Convention:** `proxy.ts` + `export default authProxy()` is canonical; use `middleware.ts` only
  when genuinely wrapping the proxy (e.g. `safeAuthProxy`, host routing).

## 0.2.1

**Fix: the session readers now force dynamic rendering before any early return.**

`currentUser()`, `session()` and `rejectedEmail()` returned `null` when WorkOS was unconfigured
*before* touching `headers()`. Every build runs without `WORKOS_*` env, so that short-circuit told
Next the page was static — baking a signed-out verdict into HTML, and failing the build outright on
any page that queries a database while prerendering. Found while migrating `admin`, whose own
pre-migration code touched `headers()` first for exactly this reason.

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
