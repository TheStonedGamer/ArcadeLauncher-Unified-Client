// Session IPC. The login command runs the challenge-response flow in Rust so
// the password never enters the webview's network layer and the token is
// decrypted natively.

import { call } from "../../lib/ipc";
import type { Session } from "./types";

export function sessionLogin(
  host: string,
  username: string,
  password: string,
  totpCode: string,
): Promise<Session> {
  return call<Session>("session_login", { host, username, password, totpCode });
}

/** Result of a self-registration request (account left pending admin approval). */
export interface RegisterOutcome {
  status: string;
  message: string;
}

/**
 * Submit a self-registration request. The account is created in a pending state
 * server-side and an admin must approve it (via emailed Approve/Deny links)
 * before the user can sign in. Rejects with the server's message on failure
 * (registration closed, duplicate username/email, validation error).
 */
export function sessionRegister(
  host: string,
  username: string,
  email: string,
  password: string,
): Promise<RegisterOutcome> {
  return call<RegisterOutcome>("session_register", { host, username, email, password });
}

/** A session as remembered on disk (the live Session plus expiry bookkeeping). */
export interface StoredSession extends Session {
  savedUnix: number;
  expiresUnix: number | null;
}

/** Persist a session so it can be restored on next launch (obfuscated at rest). */
export function sessionSave(s: Session, expiresUnix: number | null = null): Promise<void> {
  return call<void>("session_save", {
    host: s.host,
    username: s.username,
    token: s.token,
    isAdmin: s.isAdmin,
    mustChangePassword: s.mustChangePassword,
    expiresUnix,
  });
}

/** Restore a remembered session, or null if none / expired / corrupt. */
export function sessionRestore(): Promise<StoredSession | null> {
  return call<StoredSession | null>("session_restore", {});
}

/** Forget the remembered session (sign out). */
export function sessionClear(): Promise<void> {
  return call<void>("session_clear", {});
}
