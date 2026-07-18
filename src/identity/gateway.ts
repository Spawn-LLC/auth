import type { Role } from "../domain";

/**
 * The identity/tenancy port. WorkOS owns organizations, memberships (+ roles) and invitations; this
 * is the framework-free interface apps talk to. The real impl (`WorkOSIdentityGateway`) wraps
 * `@workos-inc/node`; tests inject an in-memory fake. Apps store their own org row keyed by the
 * WorkOS organization id this gateway mints.
 */
export interface IdentityGateway {
  /** Create a WorkOS organization; returns its id (use as the app's org PK). */
  createOrganization(input: { name: string }): Promise<{ id: string }>;
  /** Delete a WorkOS organization (best-effort cleanup). */
  deleteOrganization(id: string): Promise<void>;

  /** Add a user to an org with a role (idempotent — re-adding updates the role). */
  addMembership(input: { userId: string; orgId: string; role: Role }): Promise<void>;
  /** The caller's role in an org, or null if not a member (the authorization gate). */
  getMembership(userId: string, orgId: string): Promise<{ role: Role } | null>;
  /** Orgs the user belongs to, each with the user's role. */
  listUserMemberships(userId: string): Promise<{ orgId: string; role: Role }[]>;

  /** Members of an org (for team settings). */
  listMembers(orgId: string): Promise<IdentityMember[]>;
  updateMembershipRole(orgId: string, userId: string, role: Role): Promise<void>;
  removeMembership(orgId: string, userId: string): Promise<void>;

  /** Send a WorkOS invitation email joining the invitee to the org with a role. */
  inviteUser(input: { email: string; orgId: string; role: Role }): Promise<IdentityInvite>;
  listInvites(orgId: string): Promise<IdentityInvite[]>;
  revokeInvite(inviteId: string): Promise<void>;
}

/** A member of an org, resolved from a WorkOS organization membership + its user. */
export interface IdentityMember {
  user: { id: string; email: string; name: string };
  role: Role;
  createdAt: string;
}

/** A WorkOS invitation surfaced to the team settings UI. */
export interface IdentityInvite {
  id: string;
  email: string;
  role: Role;
  state: "pending" | "accepted" | "expired" | "revoked";
  createdAt: string;
}
