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
 *
 * ## There is deliberately no "redirect to my own /login" middleware mode
 *
 * It looks like the obvious third option, and it is a trap. The default mode does NOT protect
 * anything — it only refreshes. So an app that has routes reachable *only* because middleware
 * gates them (typically API route handlers with no in-handler check) becomes wide open the moment
 * it adopts this proxy. Middleware gating reads as protection while being the easiest thing to
 * silently lose to a matcher edit.
 *
 * Gate in the route instead: `requireUser()` in authed layouts, and an explicit `requireUser()` at
 * the top of every API handler that returns data. That survives matcher changes, is greppable, and
 * fails closed. Before adopting this proxy, audit for handlers whose only protection is the matcher.
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
