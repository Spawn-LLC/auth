import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `safeAuthProxy` owns the "WorkOS not configured → fail closed" decision so apps stop hand-rolling
 * it. When identity is configured it must delegate to the real proxy; when it is NOT, it must hand
 * off to the app's `onUnconfigured` fallback and never construct/run the WorkOS proxy.
 */

// authkitMiddleware() returns a middleware fn; here it returns a sentinel so we can assert delegation.
const authkitMiddlewareMock = vi.hoisted(() => vi.fn(() => vi.fn(async () => "PROXY_RAN")));
vi.mock("@workos-inc/authkit-nextjs", () => ({ authkitMiddleware: authkitMiddlewareMock }));

const { safeAuthProxy } = await import("./proxy");

const CONFIG_ENV = {
  WORKOS_API_KEY: "sk_test",
  WORKOS_CLIENT_ID: "client_test",
  WORKOS_COOKIE_PASSWORD: "x".repeat(32),
} as const;

const req = {} as never;
const event = {} as never;

beforeEach(() => {
  for (const key of Object.keys(CONFIG_ENV)) delete process.env[key];
  delete process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
  vi.clearAllMocks();
});

describe("safeAuthProxy", () => {
  it("calls onUnconfigured and never touches WorkOS when identity is unconfigured", async () => {
    const onUnconfigured = vi.fn(async () => "FALLBACK" as never);
    const middleware = safeAuthProxy({ onUnconfigured });

    const result = await middleware(req, event);

    expect(result).toBe("FALLBACK");
    expect(onUnconfigured).toHaveBeenCalledWith(req, event);
    expect(authkitMiddlewareMock).not.toHaveBeenCalled();
  });

  it("delegates to the real proxy when identity is configured", async () => {
    Object.assign(process.env, CONFIG_ENV);
    const onUnconfigured = vi.fn();
    const middleware = safeAuthProxy({ onUnconfigured });

    const result = await middleware(req, event);

    expect(result).toBe("PROXY_RAN");
    expect(onUnconfigured).not.toHaveBeenCalled();
    expect(authkitMiddlewareMock).toHaveBeenCalled();
  });
});
