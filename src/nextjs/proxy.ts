import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

import { publicPaths } from "../config";

/**
 * The app middleware/proxy. Because Spawn renders its OWN auth screens (headless), this only
 * **refreshes** the WorkOS session cookie on each request — it does NOT redirect to any hosted page.
 * Route protection is done in-app: authed layouts call `requireUser()`, which redirects
 * unauthenticated visitors to `/login` (a Spawn screen). Use as the app's `proxy.ts` default export:
 *
 *   export default authProxy();
 *   export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
 *
 * Pass `{ enforce: true }` only if you want middleware-level gating to WorkOS's hosted UI instead
 * of your own screens (not the Spawn default).
 */
export function authProxy(options?: { enforce?: boolean; unauthenticatedPaths?: string[] }) {
  if (options?.enforce) {
    return authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: options.unauthenticatedPaths ?? publicPaths(),
      },
    });
  }
  // Headless default: refresh the session only; gate via requireUser() in layouts.
  return authkitMiddleware();
}
