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
