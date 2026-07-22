/**
 * Edge-safe auth policy — imported by app middleware. NO framework or SDK imports here
 * (middleware may run on the edge runtime). This is the one choke point for "is auth configured"
 * and "who is allowed"; generalized from admin's `@admin/auth` config so every Spawn app shares it.
 */

/** Default paths reachable without a session; apps extend via `publicPaths()`. */
export const DEFAULT_PUBLIC_PATHS = ["/login", "/signup", "/verify", "/reset", "/callback"] as const;

/** The public paths for this app: the defaults plus anything in `AUTH_PUBLIC_PATHS` (comma-sep). */
export function publicPaths(): string[] {
  const extra = (process.env.AUTH_PUBLIC_PATHS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return [...DEFAULT_PUBLIC_PATHS, ...extra];
}

export function isPublicPath(pathname: string, paths: string[] = publicPaths()): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The public paths for an app that declares extra ones IN CODE (not via `AUTH_PUBLIC_PATHS`):
 * the shared defaults plus the caller's list. Lets an app keep app-specific public routes (a
 * Slack webhook, a cron tick, an unsubscribe link) alongside the login-flow defaults without a
 * local wrapper package. Pair with `isPublicPath(pathname, appPublicPaths([...]))`.
 */
export function appPublicPaths(extra: string[]): string[] {
  return [...publicPaths(), ...extra];
}

/**
 * The canonical proxy/middleware matcher — the ONE hardened regex every app should use, so the
 * pattern is defined once here instead of copy-pasted per app. Runs the session-refresh proxy on
 * everything except Next internals and genuine static assets.
 *
 * The image-extension carve-out is scoped with a negative lookahead for an "api/" path segment, so
 * it can only ever match real static files (e.g. "/favicon.svg", "/og.png") — NEVER a route whose
 * dynamic "[id]" segment happens to end in an image extension. Without that guard,
 * "PATCH /api/thing/{id}.png" escaped the gate entirely: the extension satisfied the exclusion, yet
 * Next still resolved the handler and ran it unauthenticated. API routes now always hit the proxy.
 * Apps whose routes need in-request gating still call requireUser() / requireApiUser() in the
 * handler — the matcher refreshes the cookie, it does not protect.
 */
export const AUTH_MATCHER =
  "/((?!_next/static|_next/image|favicon\\.ico|(?!(?:.*/)?api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)";

/** Ready-made proxy config: `export const config = authProxyConfig` in an app's `proxy.ts`. */
export const authProxyConfig = { matcher: [AUTH_MATCHER] } as const;

/**
 * WorkOS (the engine) is "configured" once its three required secrets are present. When it is NOT
 * configured, the seam fails CLOSED (no session → redirect to sign-in) rather than letting requests
 * through. `WORKOS_CLIENT_ID` is public (`NEXT_PUBLIC_WORKOS_CLIENT_ID` also accepted).
 */
export function isWorkosConfigured(): boolean {
  return Boolean(
    process.env.WORKOS_API_KEY &&
      (process.env.WORKOS_CLIENT_ID || process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID) &&
      process.env.WORKOS_COOKIE_PASSWORD,
  );
}

/**
 * Optional email-domain gate. Off by default (customer products let anyone sign up). Set
 * `ALLOWED_EMAIL_DOMAINS` (comma-separated) to restrict — e.g. internal tools gate to
 * `spawnpartners.com`. Returns true (allowed) when no gate is configured.
 */
export function allowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  return (raw ? raw.split(",") : [])
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Internal tools opt in with `AUTH_REQUIRE_EMAIL_DOMAINS=true`, declaring "I am gated".
 *
 * Why this exists: the whole suite shares ONE WorkOS client, so every app's user pool is every
 * other app's user pool. An internal console that relies on the env default would, the moment
 * `ALLOWED_EMAIL_DOMAINS` went missing or got typo'd, silently admit every customer of every
 * customer-facing product — with no error and no visible symptom. Declaring the requirement turns
 * that silent full-access failure into a loud boot failure.
 */
export function requiresEmailDomainGate(): boolean {
  return process.env.AUTH_REQUIRE_EMAIL_DOMAINS === "true";
}

/**
 * Throw unless the domain gate is actually configured. Call at boot (module scope) in any app that
 * must never be world-readable, so a misconfiguration fails the deploy instead of opening the door.
 */
export function assertEmailDomainGate(): void {
  if (requiresEmailDomainGate() && allowedEmailDomains().length === 0) {
    throw new Error(
      "AUTH_REQUIRE_EMAIL_DOMAINS=true but ALLOWED_EMAIL_DOMAINS is empty. This app must not run " +
        "ungated: every Spawn app shares one WorkOS user pool, so an empty gate admits everyone.",
    );
  }
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const domains = allowedEmailDomains();
  // Fail CLOSED when a gate was declared but not configured, so a dropped env var denies everyone
  // rather than admitting everyone. `assertEmailDomainGate()` should have already stopped boot.
  if (domains.length === 0) return !requiresEmailDomainGate();
  if (!email) return false;
  // Require a well-formed single-@ address with a non-empty local part. Without this, "@allowed.com"
  // (no local part) splits to the allowed domain and reads as permitted — a gate must never answer
  // "allowed" for input that isn't an address at all.
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  return domains.includes(domain);
}

/** The WorkOS client id, from either the server or the public var. */
export function workosClientId(): string {
  const id = process.env.WORKOS_CLIENT_ID || process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
  if (!id) throw new Error("WORKOS_CLIENT_ID is not set");
  return id;
}
