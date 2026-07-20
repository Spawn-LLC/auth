import { handleAuth } from "@workos-inc/authkit-nextjs";

/**
 * The OAuth callback handler for the app's `/callback` route:
 *
 *   export const GET = handleCallback({ returnPathname: "/" });
 *
 * Exchanges the WorkOS code, seals the Spawn session cookie, and forwards on. This is used for the
 * social-login round-trip (`startOAuth`) — headless email/password uses `saveSession` directly.
 *
 * ## Where the email-domain gate runs for social login
 *
 * NOT here, deliberately. The password flows in `flows.ts` gate before calling WorkOS, so no
 * credential is ever minted for an off-domain address. Social login cannot do that: the address is
 * only known after the code exchange, and authkit's `onSuccess` hook is typed
 * `(data) => void | Promise<void>` — it can observe the result but cannot redirect or veto it.
 *
 * So for OAuth the gate is enforced on READ, by `currentUser()`/`session()`/`requireUser()` in
 * `session.ts`, which return null for a disallowed domain. An off-domain social login therefore
 * receives a session cookie that grants nothing — every read treats it as signed out and the app
 * bounces to `/login`.
 *
 * The consequence worth knowing: for OAuth, those readers are load-bearing. An app that reaches
 * past them to `withAuth()` directly would see a user the gate intends to reject. Use the seam.
 */
export function handleCallback(options?: { returnPathname?: string }) {
  return handleAuth({ returnPathname: options?.returnPathname ?? "/" });
}
