# @spawn-llc/auth

**Spawn shared identity.** One WorkOS project (named **"Spawn"**) backs auth for the entire Spawn
suite — sign up for one Spawn product and you have an account on all of them. This package is the
**only** place that touches WorkOS: apps consume a Spawn-shaped API (`signIn`, `signUp`,
`currentUser`, …) and never see a WorkOS type. WorkOS is an invisible engine (password security,
OAuth, sessions, MFA, SSO, compliance — free to 1M MAU); the **UI is ours** (rendered from
`@spawn-llc/design-system`). See [`IDENTITY.md`](./IDENTITY.md) for the architecture.

## Install

```bash
pnpm add @spawn-llc/auth
```

Env (from the WorkOS "Spawn" application): `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
`WORKOS_COOKIE_PASSWORD` (32+ chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (the app's `/callback`).
Optional: `ALLOWED_EMAIL_DOMAINS` (comma-separated — restrict to e.g. `spawnpartners.com` for
internal tools), `AUTH_PUBLIC_PATHS`.

## Subpaths

- **`@spawn-llc/auth`** — core, edge-safe: the `IdentityGateway` (orgs / members / roles / invites) +
  `createIdentityGateway()`, domain types (`Role`, `Session`, `Member`, `Invite`), and policy
  (`isWorkosConfigured`, `isAllowedEmail`, `isPublicPath`).
- **`@spawn-llc/auth/config`** — the edge-safe policy alone (import from middleware; no SDK): the
  gate + `isPublicPath` / `appPublicPaths` and the shared hardened matcher (`AUTH_MATCHER` + its
  `AuthMatcher` literal type for pinning an app's inlined `config.matcher`).
- **`@spawn-llc/auth/nextjs`** — the Next server surface: the session seam
  (`currentUser` / `requireUser` / `requireApiUser` / `session` / `signOut` / `switchOrganization`),
  `authProxy()` / `safeAuthProxy()`, `handleCallback()`, and the headless flows
  (`signInWithPassword`, `signUp`, `verifyEmail`, `requestPasswordReset`, `resetPassword`,
  `startOAuth`).

## Wire an app (Next.js)

Next 16 calls this file `proxy.ts` (the old `middleware.ts` name is deprecated). Next requires
`config.matcher` to be an **inline** string literal — a `const`/imported object fails the build — so
paste the matcher and pin it to the shared `AuthMatcher` type, which fails `tsc` if it ever drifts:

```ts
// proxy.ts (refresh the session on every route; gate in-app via requireUser())
import { authProxy } from "@spawn-llc/auth/nextjs";
import type { AuthMatcher } from "@spawn-llc/auth/config";
export default authProxy();
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|(?!(?:.*/)?api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
} satisfies { readonly matcher: readonly [AuthMatcher] };
```

Need to fail closed when the WORKOS_* secrets are absent (a preview deploy)? Keep the same `proxy.ts`
but wrap with `safeAuthProxy({ onUnconfigured })` as the default export:

```ts
// proxy.ts (fail closed when identity is unconfigured)
import { safeAuthProxy } from "@spawn-llc/auth/nextjs";
import { isPublicPath } from "@spawn-llc/auth/config";
import { NextResponse } from "next/server";
export default safeAuthProxy({
  onUnconfigured: (req) =>
    isPublicPath(req.nextUrl.pathname)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login", req.url)),
});
// (same `config` block as above)
```

```ts
// app/(any)/api/route.ts — gate a route handler (401 JSON, never a redirect)
import { requireApiUser } from "@spawn-llc/auth/nextjs";
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user; // 401 when signed out
  // ...use `user`
}
```

```ts
// app/callback/route.ts (social login round-trip)
import { handleCallback } from "@spawn-llc/auth/nextjs";
export const GET = handleCallback({ returnPathname: "/" });
```

```tsx
// app/login/page.tsx — render the DS <SignIn>, wire it to the headless flow
import { SignIn } from "@spawn-llc/design-system/components/ui/sign-in";
import { signInWithPassword, startOAuth } from "@spawn-llc/auth/nextjs";
// (call these from "use server" actions; redirect on { status: "ok" })
```

Releases are tag-triggered — see [`RELEASING.md`](./RELEASING.md).
