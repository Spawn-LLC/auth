import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import type { Session, User } from "../domain";
import { isAllowedEmail, isWorkosConfigured } from "../config";

/**
 * The Spawn session seam for Next apps. ONE choke point: app code only ever calls `currentUser()` /
 * `requireUser()` / `session()` / `signOut()` — nothing outside this package knows it's WorkOS.
 * Generalized from admin's `@admin/auth` + audit's `lib/session.ts`.
 */

/**
 * Force this request to render dynamically.
 *
 * A session is per-request, so any page that asks about one must never be statically prerendered.
 * Touching `headers()` is what tells Next that. It has to happen BEFORE any early return: without
 * it, a build with no WORKOS_* env (which is every CI build) short-circuits to "signed out" and
 * Next happily bakes that verdict — and whatever the page renders for a signed-out visitor — into
 * static HTML. Pages that hit a database during that prerender fail the build outright, which is
 * how this was found.
 */
async function markDynamic(): Promise<void> {
  await headers();
}

/** The signed-in Spawn user, or null. Applies the optional email-domain gate. */
export async function currentUser(): Promise<User | null> {
  await markDynamic();
  if (!isWorkosConfigured()) return null;
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user?.email || !isAllowedEmail(user.email)) return null;
  return toUser(user);
}

/** The signed-in user; redirects to `/login` when absent. */
export async function requireUser(redirectTo = "/login"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(redirectTo);
  return user;
}

/**
 * The API-route counterpart to `requireUser()`. Returns the signed-in `User`, or a `401` JSON
 * `NextResponse` when there is no valid session.
 *
 * Why not just `requireUser()` in an API handler: `requireUser()` redirects to `/login`, which is
 * right for a browser navigation but wrong for a `fetch()` — the caller gets a `200` HTML login
 * page and a JSON parse error instead of a clean `401`. Route handlers should branch on the type:
 *
 *   const user = await requireApiUser();
 *   if (user instanceof NextResponse) return user; // 401
 *   // ...use `user`
 *
 * Applies the same email-domain gate + dynamic-render marking as `currentUser()`.
 */
export async function requireApiUser(): Promise<User | NextResponse> {
  const user = await currentUser();
  if (user) return user;
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

/** The full Spawn session (user + active org + role), or null. */
export async function session(): Promise<Session | null> {
  await markDynamic();
  if (!isWorkosConfigured()) return null;
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const info = await withAuth();
  if (!info.user?.email || !isAllowedEmail(info.user.email)) return null;
  return {
    user: toUser(info.user),
    organizationId: info.organizationId,
    role: normalizeRole(info.role),
  };
}

/** The signed-in email BEFORE the domain gate, if any — lets a login page show a wrong-domain denial. */
export async function rejectedEmail(): Promise<string | null> {
  await markDynamic();
  if (!isWorkosConfigured()) return null;
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (user?.email && !isAllowedEmail(user.email)) return user.email;
  return null;
}

/** Sign out of the current session (clears the cookie, redirects to WorkOS logout → the app). */
export async function signOut(): Promise<void> {
  const { signOut: workosSignOut } = await import("@workos-inc/authkit-nextjs");
  await workosSignOut();
}

/** Switch the active organization for a multi-org session. */
export async function switchOrganization(organizationId: string): Promise<void> {
  const { switchToOrganization } = await import("@workos-inc/authkit-nextjs");
  await switchToOrganization(organizationId);
}

/** A display name for account UI: full name if set, else email. */
export function userDisplayName(user: User): string {
  return user.name?.trim() || user.email;
}

type WorkOSUser = { id: string; email: string; firstName?: string | null; lastName?: string | null };

function toUser(u: WorkOSUser): User {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return { id: u.id, email: u.email, name: name || u.email };
}

function normalizeRole(role: string | undefined): Session["role"] {
  return role === "owner" || role === "admin" || role === "member" ? role : undefined;
}
