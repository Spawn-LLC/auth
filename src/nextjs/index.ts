/**
 * `@spawn-llc/auth/nextjs` — the Next.js server surface of Spawn identity: the session seam, the
 * gating proxy, the OAuth callback, and the headless auth flows. WorkOS is the engine; nothing here
 * exposes a WorkOS type. Pair with the core import (`@spawn-llc/auth`) for the identity gateway.
 */
export {
  currentUser,
  requireUser,
  session,
  rejectedEmail,
  signOut,
  switchOrganization,
  userDisplayName,
} from "./session";

export { authProxy } from "./proxy";
export { handleCallback } from "./callback";
export {
  signInWithPassword,
  signUp,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  startOAuth,
} from "./flows";
export type { FlowResult, OAuthProvider } from "./flows";
