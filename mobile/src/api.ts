// Thin fetch glue over the pure cores. Every decision that can be made without
// IO lives in src/core/*; this file only performs the request and hands the raw
// body back to a parser.

import { attachmentBlocker, parsePresign, presignRequest } from "./core/attach";
import { parseCatalog, parseLibrary, type MobileGame, type MobileLibrary } from "./core/catalog";
import { challengeProof, decryptToken, deriveAuthKey } from "./core/crypto";
import { parseFriends, type Friend } from "./core/friends";
import {
  parseQrSigninDetails,
  type QrSigninChallenge,
  type QrSigninDetails,
} from "./core/qr";
import {
  createOutcome,
  isSearchable,
  parseBoard,
  parseHits,
  type CreateOutcome,
  type CreateRequestBody,
  type MobileBoard,
  type RequestHit,
} from "./core/requests";
import {
  apiUrl,
  authHeaders,
  loginError,
  parseChallengeNonce,
  parseVerifyCipher,
  sessionFromLogin,
  sessionFromVerify,
  type MobileSession,
} from "./core/session";

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

/** Sign in, matching the desktop client's auth exactly: the privacy-preserving
 *  challenge-response flow first (the password never leaves the device — only a
 *  derived proof does), falling back to the plain `POST /api/login` form for
 *  accounts that have no challenge key. See src-tauri/src/session/commands.rs. */
export async function login(host: string, username: string, password: string): Promise<MobileSession> {
  const user = username.trim();
  const viaChallenge = await challengeLogin(host, user, password);
  if (viaChallenge) return viaChallenge;
  return passwordLogin(host, user, password);
}

/** Challenge-response attempt. Returns a session on full success, or null to
 *  signal "fall through to the password path" — a missing challenge key, a bad
 *  proof (wrong password), or a malformed response — so the user sees the single
 *  clear error the password attempt produces, exactly as the desktop does. */
async function challengeLogin(
  host: string,
  user: string,
  password: string,
): Promise<MobileSession | null> {
  // 1) Ask for a nonce. A non-2xx (typically 401 = no challenge key) means this
  //    account uses plain password login.
  const challenge = await request(host, `/api/auth/challenge?username=${encodeURIComponent(user)}`, {
    headers: { Accept: "application/json" },
  });
  const nonce =
    challenge.status >= 200 && challenge.status < 300 ? parseChallengeNonce(challenge.body) : null;
  if (!nonce) return null;

  // 2) Prove knowledge of the password without sending it.
  const key = deriveAuthKey(user, password);
  const proof = challengeProof(key, nonce);
  const form = `username=${encodeURIComponent(user)}&proof=${encodeURIComponent(proof)}&totpCode=`;
  const verify = await request(host, "/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  if (verify.status < 200 || verify.status >= 300) return null; // bad proof / TOTP → fall through

  // 3) Decrypt the returned bearer token with the same key.
  const cipher = parseVerifyCipher(verify.body);
  if (!cipher) return null;
  let token: string;
  try {
    token = decryptToken(key, cipher.iv, cipher.token);
  } catch {
    return null; // corrupt ciphertext — let the password path report cleanly
  }
  return sessionFromVerify(host, user, verify.body, token);
}

/** Plain form login: the fallback for accounts with no challenge key. This is
 *  the one path that sends the password (over TLS), so it runs only after the
 *  challenge flow has declined. */
async function passwordLogin(host: string, user: string, password: string): Promise<MobileSession> {
  const form = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`;
  const { status, body } = await request(host, "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  const session = status >= 200 && status < 300 ? sessionFromLogin(host, user, body) : null;
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

export async function fetchLibrary(session: MobileSession): Promise<MobileLibrary> {
  return parseLibrary(await authed(session, "/api/library"));
}

export async function addToLibrary(session: MobileSession, gameId: string): Promise<void> {
  await authed(session, `/api/library/${encodeURIComponent(gameId)}`, { method: "POST" });
}

export async function removeFromLibrary(session: MobileSession, gameId: string): Promise<void> {
  await authed(session, `/api/library/${encodeURIComponent(gameId)}`, { method: "DELETE" });
}

export async function fetchRequests(session: MobileSession): Promise<MobileBoard> {
  return parseBoard(await authed(session, "/requests/api/requests"));
}

/** IGDB-backed search for something to request. The server answers an empty
 *  result set for a query under two characters, so short ones are skipped here
 *  rather than round-tripped. `platform` is an optional server-side filter. */
export async function searchRequestCandidates(
  session: MobileSession,
  query: string,
  platform = "",
): Promise<RequestHit[]> {
  if (!isSearchable(query)) return [];
  const qs = new URLSearchParams({ q: query.trim() });
  if (platform.trim()) qs.set("platform", platform.trim());
  return parseHits(await authed(session, `/requests/api/search?${qs.toString()}`));
}

/** File a request. The server folds a request for a game already on the board
 *  into an upvote instead of creating a duplicate, so the outcome has to be
 *  read off the response rather than assumed. */
export async function createRequest(
  session: MobileSession,
  body: CreateRequestBody,
): Promise<CreateOutcome> {
  return createOutcome(
    await authed(session, "/requests/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Upvote a board row. Returns the server's own view of whether the caller has
 *  now voted, so an optimistic toggle can be corrected. */
export async function voteRequest(session: MobileSession, id: number): Promise<boolean> {
  const body = await authed(session, `/requests/api/requests/${id}/vote`, { method: "POST" });
  return !!body && typeof body === "object" && (body as { voted?: unknown }).voted === true;
}

/** The account's accepted friends, with the server's authoritative presence
 *  snapshot. The gateway then streams presence *changes* on top of this; the
 *  snapshot is what stops the DMs list reading as "nobody signed in" when a
 *  friend was already online before the phone connected. */
export async function fetchFriends(session: MobileSession): Promise<Friend[]> {
  return parseFriends(await authed(session, "/api/social/friends"));
}

/** Tell the server where to reach this device with a call notification.
 *
 *  Returns whether the server can actually send one: it accepts the token
 *  regardless (so the phone need not know how the server is configured), but
 *  reports `enabled: false` when no FCM credentials are set, and Settings shows
 *  that rather than promising ringing that will never happen. */
export async function registerPushToken(
  session: MobileSession,
  token: string,
  platform: string,
): Promise<boolean> {
  const body = (await authed(session, "/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  })) as { enabled?: unknown } | null;
  return !!body && body.enabled === true;
}

/** Stop ringing this device — sent on sign-out, so the next person to use the
 *  phone does not get the previous account's calls. */
export async function unregisterPushToken(
  session: MobileSession,
  token: string,
): Promise<void> {
  await authed(session, "/api/push/unregister", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

/** Confirm a stored token still works before showing the library. */
export async function checkSession(session: MobileSession): Promise<boolean> {
  try {
    await authed(session, "/requests/api/me");
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
    throw err;
  }
}

export async function inspectQrSignin(
  session: MobileSession,
  challenge: QrSigninChallenge,
): Promise<QrSigninDetails> {
  const form =
    `challengeId=${encodeURIComponent(challenge.challengeId)}` +
    `&scanSecret=${encodeURIComponent(challenge.scanSecret)}`;
  const { status, body } = await request(session.host, "/api/auth/qr/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
  });
  const details = status >= 200 && status < 300 ? parseQrSigninDetails(body) : null;
  if (!details) throw new ApiError(loginError(body, status), status);
  return details;
}

export async function decideQrSignin(
  session: MobileSession,
  challenge: QrSigninChallenge,
  approve: boolean,
): Promise<void> {
  const form =
    `challengeId=${encodeURIComponent(challenge.challengeId)}` +
    `&scanSecret=${encodeURIComponent(challenge.scanSecret)}` +
    `&action=${approve ? "approve" : "deny"}`;
  await authed(session, "/api/auth/qr/decide", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
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
