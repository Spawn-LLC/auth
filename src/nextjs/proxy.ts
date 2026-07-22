import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";

import { isWorkosConfigured, publicPaths } from "../config";

/**
 * The app middleware/proxy. Because Spawn renders its OWN auth screens (headless), this only
 * **refreshes** the WorkOS session cookie on each request — it does NOT redirect to any hosted page.
 * Route protection is done in-app: authed layouts call `requireUser()`, which redirects
 * unauthenticated visitors to `/login` (a Spawn screen). Use as the app's `proxy.ts` default export,
 * with the shared hardened matcher (`authProxyConfig`) — do NOT hand-write the regex:
 *
 *   import { authProxy } from "@spawn-llc/auth/nextjs";
 *   import { authProxyConfig } from "@spawn-llc/auth/config";
 *   export default authProxy();
 *   export const config = authProxyConfig;
 *
 * When an app needs its own fail-closed behavior for the WORKOS-unconfigured case (a preview deploy
 * with no secrets), wrap with `safeAuthProxy` from a `middleware.ts` instead of `proxy.ts`.
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

/**
 * `authProxy()`, but fail CLOSED when WorkOS is not configured.
 *
 * `authProxy()` assumes the WORKOS_* secrets are present; a build/preview deploy without them would
 * otherwise refresh nothing and let every request through. Rather than each app hand-rolling that
 * guard three different ways (redirect / 404 / boot-assert), `safeAuthProxy` owns the plumbing:
 * when identity is configured it delegates to `authProxy(options)`; when it is NOT, it calls the
 * app-supplied `onUnconfigured` handler so the app keeps its own fallback (redirect to `/login`,
 * 404 the gated area, `NextResponse.next()` for a public-only preview, …).
 *
 *   // middleware.ts (this wraps the proxy, so it is a middleware, not a bare proxy)
 *   import { safeAuthProxy } from "@spawn-llc/auth/nextjs";
 *   import { authProxyConfig, isPublicPath } from "@spawn-llc/auth/config";
 *   import { NextResponse } from "next/server";
 *   export default safeAuthProxy({
 *     onUnconfigured: (req) =>
 *       isPublicPath(req.nextUrl.pathname)
 *         ? NextResponse.next()
 *         : NextResponse.redirect(new URL("/login", req.url)),
 *   });
 *   export const config = authProxyConfig;
 *
 * The configured/unconfigured decision is made ONCE, when the middleware is constructed (module
 * load) — identity config does not change between requests within a running process.
 */
export function safeAuthProxy(options: {
  onUnconfigured: (request: NextRequest, event: NextFetchEvent) => ReturnType<NextMiddleware>;
  enforce?: boolean;
  unauthenticatedPaths?: string[];
}): NextMiddleware {
  const proxy = isWorkosConfigured()
    ? authProxy({ enforce: options.enforce, unauthenticatedPaths: options.unauthenticatedPaths })
    : null;
  return (request: NextRequest, event: NextFetchEvent) =>
    proxy ? proxy(request, event) : options.onUnconfigured(request, event);
}
