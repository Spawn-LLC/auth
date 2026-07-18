import { handleAuth } from "@workos-inc/authkit-nextjs";

/**
 * The OAuth callback handler for the app's `/callback` route:
 *
 *   export const GET = handleCallback({ returnPathname: "/" });
 *
 * Exchanges the WorkOS code, seals the Spawn session cookie, and forwards on. This is used for the
 * social-login round-trip (`startOAuth`) — headless email/password uses `saveSession` directly.
 */
export function handleCallback(options?: { returnPathname?: string }) {
  return handleAuth({ returnPathname: options?.returnPathname ?? "/" });
}
