import { afterEach, describe, expect, it } from "vitest";

import {
  assertEmailDomainGate,
  allowedEmailDomains,
  appPublicPaths,
  AUTH_MATCHER,
  isAllowedEmail,
  isPublicPath,
  isWorkosConfigured,
  publicPaths,
  requiresEmailDomainGate,
} from "./config";

/**
 * The policy layer is the one place a mistake is silently catastrophic rather than loudly broken:
 * every Spawn app shares ONE WorkOS user pool, so "who is allowed" decides whether an internal
 * console is visible to every customer of every customer-facing product. These tests pin the
 * failure DIRECTION — wrong answers must deny, never admit.
 */

const ENV_KEYS = [
  "ALLOWED_EMAIL_DOMAINS",
  "AUTH_REQUIRE_EMAIL_DOMAINS",
  "AUTH_PUBLIC_PATHS",
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "NEXT_PUBLIC_WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("email domain gate", () => {
  it("allows everyone when no gate is configured (customer products)", () => {
    expect(isAllowedEmail("anyone@gmail.com")).toBe(true);
  });

  it("admits only the configured domains", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "spawnpartners.com";
    expect(isAllowedEmail("alex@spawnpartners.com")).toBe(true);
    expect(isAllowedEmail("someone@gmail.com")).toBe(false);
  });

  it("normalises case, whitespace and a leading @", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = " @SpawnPartners.com , example.org ";
    expect(allowedEmailDomains()).toEqual(["spawnpartners.com", "example.org"]);
    expect(isAllowedEmail("ALEX@SPAWNPARTNERS.COM")).toBe(true);
  });

  it("rejects malformed and missing addresses rather than defaulting open", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "spawnpartners.com";
    for (const bad of [null, undefined, "", "no-at-sign", "@spawnpartners.com "]) {
      expect(isAllowedEmail(bad as string | null | undefined)).toBe(false);
    }
  });

  it("does not admit a lookalike domain that merely ends with an allowed one", () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "spawnpartners.com";
    expect(isAllowedEmail("attacker@notspawnpartners.com")).toBe(false);
    expect(isAllowedEmail("attacker@spawnpartners.com.evil.co")).toBe(false);
  });

  /**
   * The regression this whole mechanism exists for: an internal app declares it is gated, the env
   * var goes missing, and the gate must deny everyone rather than admit everyone.
   */
  it("fails CLOSED when a gate is required but not configured", () => {
    process.env.AUTH_REQUIRE_EMAIL_DOMAINS = "true";
    expect(requiresEmailDomainGate()).toBe(true);
    expect(isAllowedEmail("alex@spawnpartners.com")).toBe(false);
    expect(isAllowedEmail("anyone@gmail.com")).toBe(false);
  });

  it("assertEmailDomainGate throws when required but unset, so boot fails loudly", () => {
    process.env.AUTH_REQUIRE_EMAIL_DOMAINS = "true";
    expect(() => assertEmailDomainGate()).toThrow(/ALLOWED_EMAIL_DOMAINS is empty/);
  });

  it("assertEmailDomainGate passes once configured, and is a no-op when not required", () => {
    process.env.AUTH_REQUIRE_EMAIL_DOMAINS = "true";
    process.env.ALLOWED_EMAIL_DOMAINS = "spawnpartners.com";
    expect(() => assertEmailDomainGate()).not.toThrow();

    delete process.env.AUTH_REQUIRE_EMAIL_DOMAINS;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    expect(() => assertEmailDomainGate()).not.toThrow();
  });
});

describe("public paths", () => {
  it("covers the auth screens by default", () => {
    for (const p of ["/login", "/signup", "/verify", "/reset", "/callback"]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("matches sub-paths but not mere prefixes", () => {
    expect(isPublicPath("/login/sso")).toBe(true);
    // "/loginx" must NOT be public just because it starts with "/login".
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });

  it("extends via AUTH_PUBLIC_PATHS", () => {
    process.env.AUTH_PUBLIC_PATHS = "/api/health, /unsubscribe";
    expect(publicPaths()).toContain("/api/health");
    expect(isPublicPath("/unsubscribe")).toBe(true);
  });

  it("appPublicPaths returns the defaults plus the app's in-code list", () => {
    const paths = appPublicPaths(["/api/slack", "/api/cron/tick"]);
    expect(paths).toContain("/login"); // a shared default
    expect(paths).toContain("/api/slack");
    expect(isPublicPath("/api/cron/tick", paths)).toBe(true);
    expect(isPublicPath("/dashboard", paths)).toBe(false);
  });
});

describe("AUTH_MATCHER (the shared hardened proxy matcher)", () => {
  // Next anchors a matcher string as a full-path regex.
  const runsOn = (pathname: string) => new RegExp(`^${AUTH_MATCHER}$`).test(pathname);

  it("runs the gate on normal page routes", () => {
    expect(runsOn("/dashboard")).toBe(true);
    expect(runsOn("/gtm/api/companies/123")).toBe(true);
  });

  it("skips Next internals and genuine static assets", () => {
    expect(runsOn("/_next/static/chunk.js")).toBe(false);
    expect(runsOn("/favicon.ico")).toBe(false);
    expect(runsOn("/og.png")).toBe(false);
    expect(runsOn("/brand/logo.svg")).toBe(false);
  });

  /**
   * F1 regression: a dynamic API segment ending in an image extension must NOT escape the gate.
   * Before the "api/"-segment lookahead guard, "PATCH /gtm/api/companies/{id}.png" matched the
   * static carve-out and ran unauthenticated.
   */
  it("still runs on an API route whose dynamic id ends in an image extension", () => {
    expect(runsOn("/gtm/api/companies/123.png")).toBe(true);
    expect(runsOn("/api/thing/abc.svg")).toBe(true);
  });
});

describe("isWorkosConfigured", () => {
  it("is false unless all three secrets are present (fails closed)", () => {
    expect(isWorkosConfigured()).toBe(false);
    process.env.WORKOS_API_KEY = "sk_test";
    expect(isWorkosConfigured()).toBe(false);
    process.env.WORKOS_CLIENT_ID = "client_test";
    expect(isWorkosConfigured()).toBe(false);
    process.env.WORKOS_COOKIE_PASSWORD = "x".repeat(32);
    expect(isWorkosConfigured()).toBe(true);
  });
});
