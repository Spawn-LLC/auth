import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the flows that have actually broken in production.
 *
 * Every case below maps to a real incident or a real hole found while auditing:
 *  - the pending-token thread (verification was completely broken for every new account)
 *  - unverified sign-in reporting "invalid email or password"
 *  - raw WorkOS strings reaching the UI
 *  - the domain gate being absent from the flows entirely
 *
 * The WorkOS SDK is mocked: these assert OUR logic — what we extract from a thrown error, what we
 * hand back, and crucially what we refuse to call — not the vendor's behaviour.
 */

const cookieStore = new Map<string, string>();
const mocks = vi.hoisted(() => ({
  authenticateWithPassword: vi.fn(),
  authenticateWithEmailVerification: vi.fn(),
  createUser: vi.fn(),
  sendVerificationEmail: vi.fn(),
  createPasswordReset: vi.fn(),
  getAuthorizationUrl: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({
    userManagement: {
      authenticateWithPassword: mocks.authenticateWithPassword,
      authenticateWithEmailVerification: mocks.authenticateWithEmailVerification,
      createUser: mocks.createUser,
      sendVerificationEmail: mocks.sendVerificationEmail,
      createPasswordReset: mocks.createPasswordReset,
      getAuthorizationUrl: mocks.getAuthorizationUrl,
    },
  }),
  saveSession: mocks.saveSession,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "app.test"]]) as unknown as Headers,
  cookies: async () => ({
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name) } : undefined,
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

const {
  signInWithPassword,
  signUp,
  verifyEmail,
  requestPasswordReset,
  startOAuth,
} = await import("./flows");

/** The shape WorkOS throws when an account exists but its address is unverified. */
function emailVerificationRequired(token = "pat_test_123") {
  return Object.assign(new Error("Email verification required."), {
    code: "email_verification_required",
    pendingAuthenticationToken: token,
  });
}

const SESSION = { user: { email: "alex@spawnpartners.com" }, accessToken: "tok" };

beforeEach(() => {
  process.env.WORKOS_CLIENT_ID = "client_test";
});

afterEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  delete process.env.ALLOWED_EMAIL_DOMAINS;
  delete process.env.AUTH_REQUIRE_EMAIL_DOMAINS;
  delete process.env.WORKOS_CLIENT_ID;
});

describe("pending verification token", () => {
  it("signUp surfaces the token from the thrown error instead of discarding it", async () => {
    mocks.createUser.mockResolvedValue({ id: "user_1" });
    mocks.authenticateWithPassword.mockRejectedValue(emailVerificationRequired());

    const res = await signUp({ email: "new@example.com", password: "pw" });

    expect(res).toMatchObject({ status: "verify", pendingToken: "pat_test_123" });
    // WorkOS already sent the mail with this error; a second send would deliver a second code and
    // invalidate the one the user is reading.
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("carries the token across the redirect so verifyEmail needs only the code", async () => {
    mocks.createUser.mockResolvedValue({ id: "user_1" });
    mocks.authenticateWithPassword.mockRejectedValue(emailVerificationRequired("pat_abc"));
    await signUp({ email: "new@example.com", password: "pw" });

    mocks.authenticateWithEmailVerification.mockResolvedValue(SESSION);
    const res = await verifyEmail({ code: "123456" });

    expect(res).toEqual({ status: "ok" });
    expect(mocks.authenticateWithEmailVerification).toHaveBeenCalledWith(
      expect.objectContaining({ code: "123456", pendingAuthenticationToken: "pat_abc" }),
    );
  });

  it("never calls WorkOS with an empty token — the bug that broke every signup", async () => {
    const res = await verifyEmail({ code: "123456" });

    expect(res.status).toBe("error");
    expect(mocks.authenticateWithEmailVerification).not.toHaveBeenCalled();
  });

  it("sign-in on an unverified account routes to verify, not 'invalid password'", async () => {
    mocks.authenticateWithPassword.mockRejectedValue(emailVerificationRequired("pat_signin"));

    const res = await signInWithPassword({ email: "new@example.com", password: "pw" });

    expect(res).toMatchObject({ status: "verify", pendingToken: "pat_signin" });
  });

  it("clears the stored token once redeemed, so a stale one cannot be replayed", async () => {
    mocks.createUser.mockResolvedValue({ id: "user_1" });
    mocks.authenticateWithPassword.mockRejectedValue(emailVerificationRequired());
    await signUp({ email: "new@example.com", password: "pw" });
    mocks.authenticateWithEmailVerification.mockResolvedValue(SESSION);
    await verifyEmail({ code: "123456" });

    expect(cookieStore.size).toBe(0);
  });
});

describe("user-facing error copy", () => {
  it("maps a known WorkOS code to a sentence a person can act on", async () => {
    mocks.authenticateWithPassword.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "invalid_credentials" }),
    );

    const res = await signInWithPassword({ email: "a@example.com", password: "wrong" });

    expect(res).toEqual({ status: "error", error: "Invalid email or password." });
  });

  it("never leaks a raw WorkOS message to the screen", async () => {
    mocks.authenticateWithPassword.mockRejectedValue(
      new Error("The following requirement must be met:\n\tpending_authentication_token_string_required"),
    );

    const res = await signInWithPassword({ email: "a@example.com", password: "pw" });

    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error).not.toMatch(/requirement must be met|_string_required/);
    }
  });

  it("turns a 422 password requirement into password copy", async () => {
    mocks.createUser.mockRejectedValue(
      new Error("The following requirement must be met:\n\tpassword_too_weak"),
    );

    const res = await signUp({ email: "new@example.com", password: "abc" });

    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.error).toMatch(/password is too weak/i);
  });
});

describe("email domain gate in the flows", () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAIL_DOMAINS = "spawnpartners.com";
  });

  it("refuses to create an off-domain user — no directory write, no email sent", async () => {
    const res = await signUp({ email: "outsider@gmail.com", password: "pw" });

    expect(res.status).toBe("error");
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("refuses to mint a session for an off-domain sign-in", async () => {
    const res = await signInWithPassword({ email: "outsider@gmail.com", password: "pw" });

    expect(res.status).toBe("error");
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it("sends no reset mail off-domain, but still reports ok (no enumeration)", async () => {
    const res = await requestPasswordReset({ email: "outsider@gmail.com" });

    expect(res).toEqual({ status: "ok" });
    expect(mocks.createPasswordReset).not.toHaveBeenCalled();
  });

  it("re-checks on verify, so an older pending token cannot bypass the gate", async () => {
    cookieStore.set("spawn_pending_verification", "pat_stale");
    mocks.authenticateWithEmailVerification.mockResolvedValue({
      user: { email: "outsider@gmail.com" },
    });

    const res = await verifyEmail({ code: "123456" });

    expect(res.status).toBe("error");
    expect(mocks.saveSession).not.toHaveBeenCalled();
  });

  it("still lets an on-domain user through", async () => {
    mocks.authenticateWithPassword.mockResolvedValue(SESSION);

    const res = await signInWithPassword({ email: "alex@spawnpartners.com", password: "pw" });

    expect(res).toEqual({ status: "ok" });
    expect(mocks.saveSession).toHaveBeenCalled();
  });

  it("is a no-op for customer products with no gate configured", async () => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    mocks.authenticateWithPassword.mockResolvedValue(SESSION);

    const res = await signInWithPassword({ email: "anyone@gmail.com", password: "pw" });

    expect(res).toEqual({ status: "ok" });
  });
});

describe("startOAuth", () => {
  it("maps our provider names to WorkOS's and defaults the redirect to /callback", async () => {
    mocks.getAuthorizationUrl.mockReturnValue("https://auth.example/authorize");

    await startOAuth({ provider: "google" });

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "GoogleOAuth",
        redirectUri: "https://app.test/callback",
      }),
    );
  });
});
