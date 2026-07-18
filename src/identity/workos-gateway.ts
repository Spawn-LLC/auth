import type { IdentityGateway, IdentityInvite, IdentityMember } from "./gateway";
import type { Role } from "../domain";

// Lazy-loaded SDK type (the `@workos-inc/node` import is deferred so the package stays import-cheap).
type WorkOSClient = import("@workos-inc/node").WorkOS;

const ROLES: Role[] = ["owner", "admin", "member"];

/** Map a WorkOS role slug to our Role, defaulting unknown slugs to `member`. */
function toRole(slug: string | undefined): Role {
  return slug && (ROLES as string[]).includes(slug) ? (slug as Role) : "member";
}

/**
 * The real {@link IdentityGateway}, backed by WorkOS via `@workos-inc/node`. Our `Role` values
 * (`owner|admin|member`) are used verbatim as WorkOS role slugs — the "Spawn" environment defines
 * matching roles. This is the ONLY file that touches WorkOS org/membership/invite APIs.
 */
export class WorkOSIdentityGateway implements IdentityGateway {
  private clientPromise: Promise<WorkOSClient> | null = null;

  constructor(private readonly apiKey: string) {}

  private client(): Promise<WorkOSClient> {
    if (!this.clientPromise) {
      this.clientPromise = import("@workos-inc/node").then(({ WorkOS }) => new WorkOS(this.apiKey));
    }
    return this.clientPromise;
  }

  async createOrganization(input: { name: string }): Promise<{ id: string }> {
    const workos = await this.client();
    const org = await workos.organizations.createOrganization({ name: input.name });
    return { id: org.id };
  }

  async deleteOrganization(id: string): Promise<void> {
    const workos = await this.client();
    await workos.organizations.deleteOrganization(id);
  }

  async addMembership(input: { userId: string; orgId: string; role: Role }): Promise<void> {
    const workos = await this.client();
    const existing = await this.findMembership(input.userId, input.orgId);
    if (existing) {
      await workos.userManagement.updateOrganizationMembership(existing.id, {
        roleSlug: input.role,
      });
      return;
    }
    await workos.userManagement.createOrganizationMembership({
      userId: input.userId,
      organizationId: input.orgId,
      roleSlug: input.role,
    });
  }

  async getMembership(userId: string, orgId: string): Promise<{ role: Role } | null> {
    const m = await this.findMembership(userId, orgId);
    return m ? { role: toRole(m.role?.slug) } : null;
  }

  async listUserMemberships(userId: string): Promise<{ orgId: string; role: Role }[]> {
    const workos = await this.client();
    const res = await workos.userManagement.listOrganizationMemberships({
      userId,
      statuses: ["active"],
      limit: 100,
    });
    return res.data.map((m) => ({ orgId: m.organizationId, role: toRole(m.role?.slug) }));
  }

  async listMembers(orgId: string): Promise<IdentityMember[]> {
    const workos = await this.client();
    const res = await workos.userManagement.listOrganizationMemberships({
      organizationId: orgId,
      limit: 100,
    });
    return Promise.all(
      res.data.map(async (m) => {
        const user = await workos.userManagement.getUser(m.userId);
        const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
        return {
          user: { id: user.id, email: user.email, name },
          role: toRole(m.role?.slug),
          createdAt: m.createdAt,
        };
      }),
    );
  }

  async updateMembershipRole(orgId: string, userId: string, role: Role): Promise<void> {
    const workos = await this.client();
    const m = await this.findMembership(userId, orgId);
    if (m) await workos.userManagement.updateOrganizationMembership(m.id, { roleSlug: role });
  }

  async removeMembership(orgId: string, userId: string): Promise<void> {
    const workos = await this.client();
    const m = await this.findMembership(userId, orgId);
    if (m) await workos.userManagement.deleteOrganizationMembership(m.id);
  }

  async inviteUser(input: { email: string; orgId: string; role: Role }): Promise<IdentityInvite> {
    const workos = await this.client();
    const inv = await workos.userManagement.sendInvitation({
      email: input.email,
      organizationId: input.orgId,
      roleSlug: input.role,
    });
    // WorkOS doesn't echo the role on the Invitation; surface the one we requested.
    return {
      id: inv.id,
      email: inv.email,
      role: input.role,
      state: inv.state,
      createdAt: inv.createdAt,
    };
  }

  async listInvites(orgId: string): Promise<IdentityInvite[]> {
    const workos = await this.client();
    const res = await workos.userManagement.listInvitations({ organizationId: orgId, limit: 100 });
    return res.data
      .filter((i) => i.state === "pending")
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: "member" as Role,
        state: i.state,
        createdAt: i.createdAt,
      }));
  }

  async revokeInvite(inviteId: string): Promise<void> {
    const workos = await this.client();
    await workos.userManagement.revokeInvitation(inviteId);
  }

  /** Find the caller's (active) membership row in an org, or undefined. */
  private async findMembership(userId: string, orgId: string) {
    const workos = await this.client();
    const res = await workos.userManagement.listOrganizationMemberships({
      userId,
      organizationId: orgId,
      limit: 1,
    });
    return res.data[0];
  }
}

/** Composition-root factory. Throws unless WORKOS_API_KEY is set (no offline fallback). */
export function createIdentityGateway(): IdentityGateway {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "WORKOS_API_KEY is required — Spawn identity has no offline fallback (WorkOS is the engine).",
    );
  }
  return new WorkOSIdentityGateway(apiKey);
}
