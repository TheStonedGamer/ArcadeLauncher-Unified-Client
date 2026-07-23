// Thin fetch glue over the pure cores. Every decision that can be made without
// IO lives in src/core/*; this file only performs the request and hands the raw
// body back to a parser.

import { attachmentBlocker, parsePresign, presignRequest } from "./core/attach";
import { parseCatalog, type MobileGame } from "./core/catalog";
import { parseBoard, type MobileBoard } from "./core/requests";
import { apiUrl, authHeaders, loginError, sessionFromLogin, type MobileSession } from "./core/session";

const TIMEOUT_MS = 15000;

/** An API failure carrying a message that is safe to show the user. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(
  host: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(host, path), { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null; // A non-JSON body (proxy error page) is reported by status.
    }
    return { status: res.status, body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ApiError(aborted ? "The server did not respond" : "Could not reach the server");
  } finally {
    clearTimeout(timer);
  }
}

/** Sign in against the server's plain form endpoint. */
export async function login(host: string, username: string, password: string): Promise<MobileSession> {
  const form = `username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password)}`;
  const { status, body } = await request(host, "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  const session = status >= 200 && status < 300 ? sessionFromLogin(host, username, body) : null;
  if (!session) throw new ApiError(loginError(body, status), status);
  return session;
}

async function authed(session: MobileSession, path: string, init: RequestInit = {}): Promise<unknown> {
  const { status, body } = await request(session.host, path, {
    ...init,
    headers: { Accept: "application/json", ...authHeaders(session), ...((init.headers as Record<string, string>) ?? {}) },
  });
  if (status === 401 || status === 403) throw new ApiError("Your session expired — sign in again", status);
  if (status < 200 || status >= 300) throw new ApiError(`Request failed (HTTP ${status})`, status);
  return body;
}

export async function fetchCatalog(session: MobileSession): Promise<MobileGame[]> {
  return parseCatalog(await authed(session, "/api/catalog"));
}

export async function fetchRequests(session: MobileSession): Promise<MobileBoard> {
  return parseBoard(await authed(session, "/api/requests"));
}

/** Upvote a board row. Returns the server's own view of whether the caller has
 *  now voted, so an optimistic toggle can be corrected. */
export async function voteRequest(session: MobileSession, id: number): Promise<boolean> {
  const body = await authed(session, `/api/requests/${id}/vote`, { method: "POST" });
  return !!body && typeof body === "object" && (body as { voted?: unknown }).voted === true;
}

/** Confirm a stored token still works before showing the library. */
export async function checkSession(session: MobileSession): Promise<boolean> {
  try {
    await authed(session, "/api/me");
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
    throw err;
  }
}

/** Upload one picked file and return its attachment id, ready to hang off a
 *  chat frame. Three steps, matching the desktop client exactly: presign over
 *  the authenticated API, PUT the bytes to the URL that comes back, then hand
 *  the id to the caller.
 *
 *  The session token is deliberately NOT sent on the PUT. That URL is already
 *  signed, it points at the object store rather than at our server, and sending
 *  a bearer token to a third-party host is how tokens leak. */
export async function uploadAttachment(
  session: MobileSession,
  file: { uri: string; name: string; size: number },
): Promise<number> {
  const blocker = attachmentBlocker(file.name, file.size);
  if (blocker) throw new ApiError(blocker, 0);

  const req = presignRequest(file.name, file.size);
  const presigned = parsePresign(
    await authed(session, "/api/social/attachments/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
  );
  if (!presigned) throw new ApiError("The server would not accept that attachment", 0);

  // The bytes go up as a blob read from the picked URI. An upload gets its own
  // generous window: TIMEOUT_MS is sized for a JSON round-trip, and 25 MiB over
  // a phone connection is not that.
  const blob = await (await fetch(file.uri)).blob();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(presigned.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": req.contentType },
      body: blob,
      signal: controller.signal,
    });
    if (!res.ok) throw new ApiError(`Upload failed (HTTP ${res.status})`, res.status);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("The upload did not finish", 0);
  } finally {
    clearTimeout(timer);
  }
  return presigned.attachmentId;
}

/** A short-lived download URL for an attachment somebody sent us. The server
 *  gates this on being a party to the conversation, so an id guessed from
 *  someone else's chat resolves to nothing. */
export async function attachmentUrl(
  session: MobileSession,
  attachmentId: number,
): Promise<{ url: string; filename: string; contentType: string } | null> {
  const body = await authed(session, `/api/social/attachments/${attachmentId}`);
  if (!body || typeof body !== "object") return null;
  const v = body as Record<string, unknown>;
  // `downloadUrl` is the server's field name, as read by the desktop client's
  // AttachmentLink; nothing else is guessed at.
  const url = typeof v.downloadUrl === "string" ? v.downloadUrl : "";
  if (!url) return null;
  return {
    url,
    filename: typeof v.filename === "string" ? v.filename : "attachment",
    contentType: typeof v.contentType === "string" ? v.contentType : "application/octet-stream",
  };
}
