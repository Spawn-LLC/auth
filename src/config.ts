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

export function isAllowedEmail(email: string | null | undefined): boolean {
  const domains = allowedEmailDomains();
  if (domains.length === 0) return true; // no gate configured → everyone allowed
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  return domain ? domains.includes(domain) : false;
}

/** The WorkOS client id, from either the server or the public var. */
export function workosClientId(): string {
  const id = process.env.WORKOS_CLIENT_ID || process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
  if (!id) throw new Error("WORKOS_CLIENT_ID is not set");
  return id;
}
