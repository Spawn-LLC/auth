import { headers } from "next/headers";
import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";

import { workosClientId } from "../config";

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

function message(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return fallback;
}

/** Email + password sign-in. Seals the Spawn session on success. */
export async function signInWithPassword(input: {
  email: string;
  password: string;
}): Promise<FlowResult> {
  try {
    const res = await getWorkOS().userManagement.authenticateWithPassword({
      clientId: workosClientId(),
      email: input.email,
      password: input.password,
    });
    await saveSession(res, await origin());
    return { status: "ok" };
  } catch (err) {
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
    } catch {
      // Most likely email verification is required — WorkOS has sent (or will send) the mail.
      await workos.userManagement.sendVerificationEmail({ userId: user.id }).catch(() => {});
      return { status: "verify", email: input.email };
    }
  } catch (err) {
    return { status: "error", error: message(err, "Could not create your account.") };
  }
}

/** Verify an email with the code WorkOS mailed; seals the session on success. */
export async function verifyEmail(input: {
  code: string;
  pendingToken?: string;
}): Promise<FlowResult> {
  try {
    const res = await getWorkOS().userManagement.authenticateWithEmailVerification({
      clientId: workosClientId(),
      code: input.code,
      pendingAuthenticationToken: input.pendingToken ?? "",
    });
    await saveSession(res, await origin());
    return { status: "ok" };
  } catch (err) {
    return { status: "error", error: message(err, "That code didn't work. Try again.") };
  }
}

/** Request a password-reset email (WorkOS sends it). Always reports success (no account enumeration). */
export async function requestPasswordReset(input: { email: string }): Promise<FlowResult> {
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
