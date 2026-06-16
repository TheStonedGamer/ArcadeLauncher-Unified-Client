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
