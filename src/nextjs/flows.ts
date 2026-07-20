import { cookies, headers } from "next/headers";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";

import { isAllowedEmail, workosClientId } from "../config";

/**
 * Headless auth flows — the Spawn API over WorkOS's User Management. Our own screens call these;
 * WorkOS does the crypto. On success the session cookie is sealed via `saveSession`, so the caller
 * just redirects. Password/verify/reset flows are here; social login uses `startOAuth` + the
 * `/callback` handler. WorkOS still sends the transactional emails (for now).
 */

export type FlowResult =
  | { status: "ok" }
  | { status: "verify"; email: string; pendingToken?: string }
  | { status: "error"; error: string };

const SUPPORTED_OAUTH = {
  google: "GoogleOAuth",
  microsoft: "MicrosoftOAuth",
  apple: "AppleOAuth",
  github: "GitHubOAuth",
} as const;
export type OAuthProvider = keyof typeof SUPPORTED_OAUTH;

/** The current request's origin (for sealing the session cookie + building redirect URIs). */
async function origin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * WorkOS error codes we can say something useful about. Everything else falls back to the sentence
 * the call site supplies.
 *
 * The rule this enforces: a raw API string NEVER reaches a screen. WorkOS messages are written for
 * whoever is reading the API logs — "The following requirement must be met:
 * pending_authentication_token_string_required" is a correct thing to tell a developer and a
 * useless thing to tell someone trying to sign up. Map what we recognise, fall back otherwise.
 */
const FRIENDLY: Record<string, string> = {
  email_not_available: "An account with that email already exists. Try signing in instead.",
  email_verification_required: "Check your email for a verification code to finish signing in.",
  invalid_credentials: "Invalid email or password.",
  invalid_one_time_code: "That code isn't right. Check the latest email and try again.",
  password_strength_error: "That password is too weak. Use at least 8 characters, mixing letters and numbers.",
  user_not_found: "Invalid email or password.",
  organization_not_found: "That workspace no longer exists.",
  mfa_enrollment: "This account needs multi-factor authentication set up before signing in.",
  sso_required: "This account signs in through your company's identity provider.",
  rate_limit_exceeded: "Too many attempts. Wait a minute and try again.",
};

/** The WorkOS error code, if this looks like a WorkOS exception. */
function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The requirement codes from a WorkOS 422.
 *
 * `UnprocessableEntityException` does NOT expose the response's `errors` array — the SDK
 * (@workos-inc/node 10.8.0) folds it into `message` and the instance carries only
 * status/name/message/code/requestID. So the codes are recovered from the message body:
 *
 *     The following requirement must be met:
 *     \tpassword_too_weak
 *
 * Only bare snake_case tokens are taken, never prose, so nothing user-hostile can leak
 * through this path — the tokens are matched against copy, never returned.
 */
function requirementCodes(err: unknown): string[] {
  const msg = (err as { message?: unknown } | null)?.message;
  if (typeof msg !== "string") return [];
  return msg
    .split("\n")
    .slice(1) // line 0 is the "The following requirement..." preamble
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9_]+$/.test(line));
}

/**
 * A user-facing sentence for a failed flow. Deliberately never returns `err.message` — see FRIENDLY.
 * Field-validation failures carry their specifics in the requirement codes rather than `code`, so a
 * password complaint is recognised there and everything else takes the call site's fallback.
 */
function message(err: unknown, fallback: string): string {
  const code = errorCode(err);
  if (code && FRIENDLY[code]) return FRIENDLY[code];

  // 422 field violations. Prefer an exact code match, then fall back to the field the
  // requirement names, so an unseen "password_*" code still gets password copy.
  const requirements = requirementCodes(err);
  for (const requirement of requirements) {
    if (FRIENDLY[requirement]) return FRIENDLY[requirement];
  }
  if (requirements.some((r) => r.includes("password"))) return FRIENDLY.password_strength_error;
  if (requirements.some((r) => r.includes("email"))) return "That email doesn't look right.";

  // Kept for error shapes that DO carry errors[] (other exception classes, future SDKs).
  const errors = (err as { errors?: unknown } | null)?.errors;
  if (Array.isArray(errors)) {
    const field = errors.find(
      (e): e is { field: string } =>
        !!e && typeof e === "object" && typeof (e as { field?: unknown }).field === "string",
    )?.field;
    if (field === "password") return FRIENDLY.password_strength_error;
    if (field === "email") return "That email doesn't look right.";
  }

  return fallback;
}

/**
 * WorkOS signals "this account still needs to verify its email" by THROWING an
 * AuthenticationException whose `pendingAuthenticationToken` is the only way to complete the
 * verification. Pull it out structurally (no WorkOS type imported, so nothing leaks).
 */
function pendingVerificationToken(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { code?: unknown; pendingAuthenticationToken?: unknown };
  if (e.code !== "email_verification_required") return undefined;
  return typeof e.pendingAuthenticationToken === "string" ? e.pendingAuthenticationToken : undefined;
}

/**
 * The email-domain gate, applied BEFORE any WorkOS call.
 *
 * The session readers in `session.ts` already gate, but that is too late for two reasons: `signUp`
 * would first create a real user in the shared "Spawn" directory (and mail them) for a domain that
 * is not entitled to one, and `signInWithPassword` would seal a valid session cookie that only the
 * readers' gate then neutralises. Denying up front means the credential is never minted and the
 * directory is never written.
 *
 * Returns null when allowed. No account-enumeration concern: the allowed domain is public policy,
 * not a statement about whether an account exists.
 */
function domainRejection(email: string): FlowResult | null {
  if (isAllowedEmail(email)) return null;
  return { status: "error", error: "That email address isn't allowed to sign in here." };
}

/**
 * The pending token has to survive the redirect from sign-up/sign-in to the verify screen. It is a
 * short-lived credential, so it rides in an httpOnly cookie rather than the URL — apps just render
 * their verify screen and call `verifyEmail({ code })`; this module threads the token for them.
 */
const PENDING_COOKIE = "spawn_pending_verification";
const PENDING_TTL_SECONDS = 15 * 60;

async function rememberPendingToken(token: string): Promise<void> {
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_TTL_SECONDS,
  });
}

async function takePendingToken(): Promise<string | undefined> {
  return (await cookies()).get(PENDING_COOKIE)?.value;
}

async function clearPendingToken(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}

/** Email + password sign-in. Seals the Spawn session on success. */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<FlowResult> {
  const rejected = domainRejection(input.email);
  if (rejected) return rejected;
  try {
    const res = await getWorkOS().userManagement.authenticateWithPassword({
      clientId: workosClientId(),
      email: input.email,
      password: input.password,
    });
    await saveSession(res, await origin());
    return { status: "ok" };
  } catch (err) {
    // Correct credentials, unverified address: route to the verify screen with the token that
    // makes the emailed code redeemable, instead of reporting a bogus credential failure.
    const pendingToken = pendingVerificationToken(err);
    if (pendingToken) {
      await rememberPendingToken(pendingToken);
      return { status: "verify", email: input.email, pendingToken };
    }
    return { status: "error", error: message(err, "Invalid email or password.") };
  }
}

/**
 * Create an account. If the environment requires email verification, WorkOS sends the mail and we
 * return `verify`; otherwise the new user is signed in and the session sealed.
 */
export async function signUp(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<FlowResult> {
  const rejected = domainRejection(input.email);
  if (rejected) return rejected;
  const workos = getWorkOS();
  try {
    const user = await workos.userManagement.createUser({
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    try {
      const res = await workos.userManagement.authenticateWithPassword({
        clientId: workosClientId(),
        email: input.email,
        password: input.password,
      });
      await saveSession(res, await origin());
      return { status: "ok" };
    } catch (err) {
      // Email verification required. WorkOS sends the mail itself and hands back the pending
      // token on the thrown error — it MUST be carried to verifyEmail or the code cannot be
      // redeemed, so surface it rather than re-sending a second mail.
      const pendingToken = pendingVerificationToken(err);
      if (pendingToken) {
        await rememberPendingToken(pendingToken);
      } else {
        await workos.userManagement.sendVerificationEmail({ userId: user.id }).catch(() => {});
      }
      return { status: "verify", email: input.email, pendingToken };
    }
  } catch (err) {
    return { status: "error", error: message(err, "Could not create your account.") };
  }
}

/**
 * Verify an email with the code we mailed; seals the session on success. `pendingToken` comes from
 * the preceding signUp/signIn result and is REQUIRED — the code alone cannot be redeemed.
 */
export async function verifyEmail(input: {
  code: string;
  pendingToken?: string;
}): Promise<FlowResult> {
  const pendingToken = input.pendingToken ?? (await takePendingToken());
  if (!pendingToken) {
    return {
      status: "error",
      error: "This verification session expired. Sign in again to get a new code.",
    };
  }
  try {
    const res = await getWorkOS().userManagement.authenticateWithEmailVerification({
      clientId: workosClientId(),
      code: input.code,
      pendingAuthenticationToken: pendingToken,
    });
    // Re-check the gate here too: this path mints a session without ever passing through
    // signIn/signUp (a pending token from an earlier, ungated build would otherwise sail through).
    const rejected = domainRejection(res.user.email);
    if (rejected) {
      await clearPendingToken();
      return rejected;
    }
    await saveSession(res, await origin());
    await clearPendingToken();
    return { status: "ok" };
  } catch (err) {
    // A wrong code is retryable, so the cookie stays. A rejected *token* is not — the session it
    // represents is gone, and leaving it would make every retry fail the same way with a message
    // about the code. Drop it so the next attempt reports the real problem.
    const code = errorCode(err);
    if (code && code.startsWith("pending_authentication_token")) {
      await clearPendingToken();
      return {
        status: "error",
        error: "This verification session expired. Sign in again to get a new code.",
      };
    }
    return { status: "error", error: message(err, "That code didn't work. Try again.") };
  }
}

/** Request a password-reset email (WorkOS sends it). Always reports success (no account enumeration). */
export async function requestPasswordReset(input: { email: string }): Promise<FlowResult> {
  // Off-domain addresses get the same "ok" as everyone else (no enumeration) but no mail is sent —
  // a gated app must not emit Spawn-branded email to addresses it would never let sign in.
  if (!isAllowedEmail(input.email)) return { status: "ok" };
  try {
    await getWorkOS().userManagement.createPasswordReset({ email: input.email });
  } catch {
    // swallow — never reveal whether the email exists
  }
  return { status: "ok" };
}

/** Complete a password reset with the token from the email + a new password. */
export async function resetPassword(input: {
  token: string;
  newPassword: string;
}): Promise<FlowResult> {
  try {
    await getWorkOS().userManagement.resetPassword({
      token: input.token,
      newPassword: input.newPassword,
    });
    return { status: "ok" };
  } catch (err) {
    return { status: "error", error: message(err, "That reset link is invalid or expired.") };
  }
}

/** The WorkOS authorization URL to start a social-login round-trip; redirect the browser to it. */
export async function startOAuth(input: {
  provider: OAuthProvider;
  redirectUri?: string;
}): Promise<string> {
  const redirectUri = input.redirectUri ?? `${await origin()}/callback`;
  return getWorkOS().userManagement.getAuthorizationUrl({
    clientId: workosClientId(),
    provider: SUPPORTED_OAUTH[input.provider],
    redirectUri,
  });
}
