// Typed IPC wrappers for the DM-attachment commands (src-tauri/src/social/
// commands.rs). The Rust side does the presign → PUT-bytes upload and the
// presigned-download lookup, all authed with the session token; bytes never
// transit the webview. These wrappers are the thin frontend seam.

import { call } from "../../lib/ipc";
import type { Profile } from "./profile";
import type { RawFriendMeta } from "./friendMeta";
import type { Privacy, FriendPolicy, DmPolicy } from "./privacy";

/** Result of uploading a local file as a pending DM attachment. */
export interface UploadedAttachment {
  attachmentId: number;
  filename: string;
  size: number;
}

/** A short-lived presigned download for one attachment, plus its metadata. */
export interface AttachmentLink {
  downloadUrl: string;
  filename: string;
  contentType: string | null;
  size: number;
}

/** Upload a picked file; returns the attachment id to send on a `chat` frame. */
export function uploadAttachment(host: string, token: string, filePath: string): Promise<UploadedAttachment> {
  return call("social_attachment_upload", { host, token, filePath });
}

/** Resolve a presigned download URL (+ metadata) for an attachment id. */
export function attachmentLink(host: string, token: string, attachmentId: number): Promise<AttachmentLink> {
  return call("social_attachment_url", { host, token, attachmentId });
}

/** Fetch any account's public profile (banner/bio/level/xp). */
export function fetchProfile(host: string, token: string, userId: number): Promise<Profile> {
  return call("social_profile_get", { host, token, userId });
}

/** Update the caller's own profile; only supplied fields change. */
export function updateProfile(
  host: string,
  token: string,
  banner: string | null,
  bio: string | null,
): Promise<void> {
  return call("social_profile_update", { host, token, banner, bio });
}

/** One username-search hit. */
export interface SearchHit {
  userId: number;
  username: string;
}

/** Fetch all of the caller's friend-meta rows (notes/groups/pinned). */
export function fetchFriendMeta(host: string, token: string): Promise<RawFriendMeta[]> {
  return call("social_friendmeta_get", { host, token });
}

/** Upsert note/groups/pinned for one friend; only supplied fields change. */
export function setFriendMeta(
  host: string,
  token: string,
  userId: number,
  fields: { note?: string; groups?: string; pinned?: boolean },
): Promise<void> {
  return call("social_friendmeta_set", { host, token, userId, ...fields });
}

/** Search accounts by username (server LIKE, ≤20, excludes self/blocks). */
export function searchUsers(host: string, token: string, query: string): Promise<SearchHit[]> {
  return call("social_user_search", { host, token, query });
}

/** Send a friend request by username; resolves to the server's status string. */
export function sendFriendRequest(host: string, token: string, username: string): Promise<string> {
  return call("social_friend_request", { host, token, username });
}

/** How to respond to / unwind a friendship. `accept`/`decline` answer an
 *  incoming request; `cancel` withdraws one I sent; `remove` un-friends; `ignore`
 *  silently drops an incoming request without telling the sender. */
export type FriendAction = "accept" | "decline" | "cancel" | "remove" | "ignore";

/** Respond to a friend request (or remove a friend); resolves to the server's
 *  status string (e.g. "accepted" / "removed"). */
export function respondToFriendRequest(
  host: string,
  token: string,
  userId: number,
  action: FriendAction,
): Promise<string> {
  return call("social_friend_respond", { host, token, userId, action });
}

/** Fetch the caller's friend-request + DM privacy policies. */
export function fetchPrivacy(host: string, token: string): Promise<Privacy> {
  return call("social_privacy_get", { host, token });
}

/** Update privacy policies; only supplied fields change. Returns the new state. */
export function updatePrivacy(
  host: string,
  token: string,
  fields: { friendPolicy?: FriendPolicy; dmPolicy?: DmPolicy },
): Promise<Privacy> {
  return call("social_privacy_set", { host, token, ...fields });
}

/** Fetch the account ids the caller is ignoring. */
export function fetchIgnores(host: string, token: string): Promise<number[]> {
  return call("social_ignores_get", { host, token });
}

/** Add or remove a persistent ignore on another account. */
export function setIgnore(host: string, token: string, userId: number, ignore: boolean): Promise<void> {
  return call("social_ignore_set", { host, token, userId, ignore });
}

/** WebRTC ICE config for a voice call (STUN + short-lived TURN credentials). */
export interface IceConfig {
  /** RTCIceServer-shaped entries (urls may be a string or string[]). */
  iceServers: RTCIceServer[];
  /** TURN credential lifetime in seconds (0 = STUN-only, no expiry). */
  ttl: number;
}

/** Fetch per-call ICE servers (STUN + scoped TURN creds) for voice (T9g). */
export function fetchTurnServers(host: string, token: string): Promise<IceConfig> {
  return call("social_turn_servers", { host, token });
}
