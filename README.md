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
  gate + `isPublicPath` / `appPublicPaths` and the shared hardened matcher (`AUTH_MATCHER`,
  `authProxyConfig`).
- **`@spawn-llc/auth/nextjs`** — the Next server surface: the session seam
  (`currentUser` / `requireUser` / `requireApiUser` / `session` / `signOut` / `switchOrganization`),
  `authProxy()` / `safeAuthProxy()`, `handleCallback()`, and the headless flows
  (`signInWithPassword`, `signUp`, `verifyEmail`, `requestPasswordReset`, `resetPassword`,
  `startOAuth`).

## Wire an app (Next.js)

```ts
// proxy.ts (refresh the session on every route; gate in-app via requireUser())
import { authProxy } from "@spawn-llc/auth/nextjs";
import { authProxyConfig } from "@spawn-llc/auth/config";
export default authProxy();
export const config = authProxyConfig; // the one shared hardened matcher — don't hand-write it
```

Need to fail closed when the WORKOS_* secrets are absent (a preview deploy)? Use a `middleware.ts`
that wraps the proxy with `safeAuthProxy({ onUnconfigured })` instead of a bare `proxy.ts`.

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
