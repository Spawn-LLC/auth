import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session readers must ALWAYS opt the request into dynamic rendering, even when they can
 * answer without asking the identity provider.
 *
 * Why this is worth a test: a build runs with no WORKOS_* env, so every reader takes its
 * "not configured → null" path. If that path returns before touching `headers()`, Next concludes
 * the page is static and bakes in whatever a signed-out visitor would see. Pages that query a
 * database while prerendering then fail the build outright — which is exactly how the regression
 * was found, during admin's migration onto this package.
 */

const headersMock = vi.hoisted(() => vi.fn(async () => new Headers()));

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { currentUser, session, rejectedEmail, requireApiUser } = await import("./session");

beforeEach(() => {
  // No WORKOS_* env: every reader takes the short-circuit path.
  delete process.env.WORKOS_API_KEY;
  delete process.env.WORKOS_CLIENT_ID;
  delete process.env.WORKOS_COOKIE_PASSWORD;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dynamic rendering is forced before any early return", () => {
  it("currentUser touches headers() even when identity is unconfigured", async () => {
    expect(await currentUser()).toBeNull();
    expect(headersMock).toHaveBeenCalled();
  });

  it("session touches headers() even when identity is unconfigured", async () => {
    expect(await session()).toBeNull();
    expect(headersMock).toHaveBeenCalled();
  });

  it("rejectedEmail touches headers() even when identity is unconfigured", async () => {
    expect(await rejectedEmail()).toBeNull();
    expect(headersMock).toHaveBeenCalled();
  });
});

/**
 * `requireApiUser` is the API-handler gate: unlike `requireUser()` it must NOT redirect (a `fetch()`
 * caller would get HTML + a JSON parse error). With no session it returns a 401 `NextResponse` the
 * handler forwards.
 */
describe("requireApiUser", () => {
  it("returns a 401 NextResponse (not a redirect) when there is no session", async () => {
    const { redirect } = await import("next/navigation");
    const result = await requireApiUser();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(redirect).not.toHaveBeenCalled();
  });
});
