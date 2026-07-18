/**
 * Spawn identity domain types — framework-free, shared by every app. WorkOS is the engine behind
 * these, but nothing here imports a WorkOS type: apps speak Spawn's vocabulary, never the vendor's.
 */

/** A member's role in an organization. Maps 1:1 to a WorkOS environment role slug. */
export type Role = "owner" | "admin" | "member";

/** A signed-in person. */
export interface User {
  id: string;
  email: string;
  name: string;
}

/** The Spawn session — the provider-neutral shape apps consume (never a WorkOS `UserInfo`). */
export interface Session {
  user: User;
  /** The active organization for this session, if the app is org-scoped. */
  organizationId?: string;
  /** The user's role in the active organization, if any. */
  role?: Role;
}

/** An organization a user belongs to, with that user's role — for org switchers. */
export interface OrgMembership {
  orgId: string;
  role: Role;
}

/** A member row for team settings: the membership plus the user it belongs to. */
export interface Member {
  user: User;
  role: Role;
  createdAt: string;
}

/** A pending team invitation. */
export interface Invite {
  id: string;
  email: string;
  role: Role;
  state: "pending" | "accepted" | "expired" | "revoked";
  createdAt: string;
}
