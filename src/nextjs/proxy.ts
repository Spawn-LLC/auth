import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

import { DEFAULT_PUBLIC_PATHS, publicPaths } from "../config";

/**
 * The app-gating proxy/middleware. Wraps WorkOS AuthKit so every route requires a Spawn session
 * except the auth paths (`/login`, `/signup`, `/verify`, `/reset`, `/callback`, plus any in
 * `AUTH_PUBLIC_PATHS`). Use as the default export of the app's `proxy.ts` / `middleware.ts`.
 *
 *   export default authProxy();
 *   export const config = { matcher: [...] };
 */
export function authProxy(options?: { unauthenticatedPaths?: string[] }) {
  const unauthenticatedPaths = options?.unauthenticatedPaths ?? publicPaths();
  return authkitMiddleware({
    middlewareAuth: { enabled: true, unauthenticatedPaths },
  });
}

export { DEFAULT_PUBLIC_PATHS };
