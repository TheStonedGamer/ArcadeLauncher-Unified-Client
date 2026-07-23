// Pure session core for the mobile companion (ROADMAP T12l). Host
// normalization, credential validation and login-response parsing — no fetch,
// no React Native, no storage. Mirrors the desktop client's rules
// (src-tauri/src/session/commands.rs) so the same host string works in both.
//
// The companion uses the server's plain `POST /api/login` form endpoint rather
// than the desktop's challenge-response path: replicating the AES challenge
// crypto on-device would be a second implementation of a security-critical
// routine, and the request is TLS-protected either way.

export interface MobileSession {
  /** Authority only — no scheme, no trailing slash. */
  host: string;
  username: string;
  token: string;
  isAdmin: boolean;
}

/** Strip any scheme, path, whitespace and trailing slashes so callers can build
 *  `https://{host}/api/...` without double slashes or a doubled scheme. */
export function normalizeHost(host: string): string {
  const trimmed = (host ?? "").trim();
  const noScheme = trimmed.replace(/^https?:\/\//i, "");
  return noScheme.replace(/\/+$/, "").split("/")[0];
}

/** A host is usable if it has a non-empty authority and no obvious junk. */
export function isValidHost(host: string): boolean {
  const h = normalizeHost(host);
  return h.length > 0 && !/\s/.test(h);
}

/** Full URL for a server API path. `path` may omit the leading slash. */
export function apiUrl(host: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${normalizeHost(host)}${p}`;
}

/** Why a sign-in attempt can't even be sent. null = go ahead. */
export function loginBlocker(host: string, username: string, password: string): string | null {
  if (!isValidHost(host)) return "Enter your server address";
  if (!username.trim()) return "Enter your username";
  if (!password) return "Enter your password";
  return null;
}

/** Build a session from the server's login response. Returns null when the
 *  response carries no token — the caller shows the server's error instead of
 *  pretending the sign-in worked. */
export function sessionFromLogin(host: string, username: string, body: unknown): MobileSession | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token !== "string" || !b.token) return null;
  const name = typeof b.username === "string" && b.username ? b.username : username.trim();
  return {
    host: normalizeHost(host),
    username: name,
    token: b.token,
    isAdmin: b.isAdmin === true,
  };
}

/** Pull the server's own error message out of a failed response body, falling
 *  back to a status-based line so the user never sees a bare "failed". */
export function loginError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const e = (body as Record<string, unknown>).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  if (status === 401 || status === 403) return "Wrong username or password";
  return `Sign-in failed (HTTP ${status})`;
}

/** Bearer header for authenticated calls. */
export function authHeaders(session: MobileSession): Record<string, string> {
  return { Authorization: `Bearer ${session.token}` };
}

/** Narrow a persisted session back out of storage; null if it's unusable, so a
 *  corrupt or half-written record sends the user to the sign-in screen rather
 *  than into a broken app. */
export function parseStoredSession(raw: unknown): MobileSession | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.host !== "string" || !normalizeHost(v.host)) return null;
  if (typeof v.token !== "string" || !v.token) return null;
  return {
    host: normalizeHost(v.host),
    username: typeof v.username === "string" ? v.username : "",
    token: v.token,
    isAdmin: v.isAdmin === true,
  };
}
