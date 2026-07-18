/**
 * `@spawn-llc/auth` — Spawn shared identity. Core (edge-safe, framework-free) surface: the identity
 * gateway, domain types, and the auth policy. WorkOS is the engine behind all of it and never leaks
 * through — apps speak Spawn's vocabulary. For the Next.js session seam + headless flows, import
 * from `@spawn-llc/auth/nextjs`.
 */
export type {
  Role,
  User,
  Session,
  OrgMembership,
  Member,
  Invite,
} from "./domain";

export type { IdentityGateway, IdentityMember, IdentityInvite } from "./identity/gateway";
export { WorkOSIdentityGateway, createIdentityGateway } from "./identity/workos-gateway";

export {
  DEFAULT_PUBLIC_PATHS,
  publicPaths,
  isPublicPath,
  isWorkosConfigured,
  allowedEmailDomains,
  isAllowedEmail,
  workosClientId,
} from "./config";
