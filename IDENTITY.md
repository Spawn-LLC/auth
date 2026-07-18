# Spawn identity

**We use one WorkOS project, named "Spawn," as the identity backend for the entire Spawn suite.**
An account on one Spawn product is an account on all of them — users are shared. This document is
the canonical reference for how Spawn auth works.

## Principles

1. **One project.** A single WorkOS project/organization (the AuthKit application is named
   **"Spawn"**) backs every app — one shared user pool. Each app is a client of the same project.
2. **WorkOS is an invisible engine.** It provides password security, OAuth, sessions, MFA, SSO, and
   compliance (free to 1M MAU). No app renders a WorkOS page or exposes a WorkOS type. The
   developer-facing API is `@spawn-llc/auth`; the user-facing UI is `@spawn-llc/design-system`.
3. **Own the UI, rent the engine.** Screens are ours (headless, from the design system). Auth is
   WorkOS's. We never store passwords.
4. **One choke point.** All identity goes through this package. Swapping providers would touch only
   here.

## Architecture

```
@spawn-llc/design-system   →  <SignIn> <SignUp> <VerifyEmail> <ResetPassword> …  (the UI)
@spawn-llc/auth            →  session seam + headless flows + IdentityGateway    (the wiring)
        └── WorkOS (User Management API)                                          (the engine)
app                        →  own /login /signup /verify /reset routes rendering the DS screens,
                              wired to @spawn-llc/auth; middleware = authProxy(); /callback = handleCallback()
```

- **Sessions & flows:** `@spawn-llc/auth/nextjs` — `currentUser`/`requireUser`/`session`/`signOut`,
  `authProxy`, `handleCallback`, and headless `signInWithPassword`/`signUp`/`verifyEmail`/
  `requestPasswordReset`/`resetPassword`/`startOAuth` (each calls WorkOS then seals the cookie).
- **Tenancy:** `IdentityGateway` (core) — WorkOS organizations, memberships, roles
  (`owner`/`admin`/`member`), invitations. Apps keep their own org row keyed by the WorkOS org id.
- **Policy:** `@spawn-llc/auth/config` (edge-safe) — `isWorkosConfigured`, `isAllowedEmail`
  (optional domain gate for internal tools), `isPublicPath`.

## The "Spawn" WorkOS project

- Team: **Spawn** · Environments: **Staging** (`environment_01KXS4E6ENF6ANWMAPCHJVEN27`) and
  **Production** (`environment_01KXS4E74YNNKSBGC2J06YKCDH`).
- AuthKit application **"Spawn"** — Staging `app_01KXS4E74NTVBDEMPQFY32YGAC`
  (client `client_01KXS4E6XDET3JSD7H8PTEAKBZ`), Production `app_01KXS4E7K3QZ9A7PDFHD841SNS`
  (client `client_01KXS4E79KKPHTSCJWAEM3CJYR`).
- Roles: `owner`, `admin`, `member`. Branding: light, Geist, Spawn logo (see the audit repo's
  `config/authkit-branding.json`).
- **Emails: WorkOS-sent for now** (verification / reset / invite). Owning branded email is a
  deferred roadmap item.

## Add auth to a new Spawn app

1. `pnpm add @spawn-llc/auth @spawn-llc/design-system`.
2. Env from the "Spawn" application: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`,
   `NEXT_PUBLIC_WORKOS_REDIRECT_URI=<app>/callback`; add that redirect URI in the WorkOS dashboard.
3. `proxy.ts` → `export default authProxy()`. `app/callback/route.ts` → `export const GET =
   handleCallback()`.
4. Build `/login`, `/signup`, `/verify`, `/reset` rendering the DS screens, wired to the headless
   flows via `"use server"` actions.
5. Internal-only tool? Set `ALLOWED_EMAIL_DOMAINS=spawnpartners.com`.

Because every app points at the same "Spawn" project, the user is the same everywhere.
