// Typed IPC wrappers for the DM-attachment commands (src-tauri/src/social/
// commands.rs). The Rust side does the presign → PUT-bytes upload and the
// presigned-download lookup, all authed with the session token; bytes never
// transit the webview. These wrappers are the thin frontend seam.

import { call } from "../../lib/ipc";
import type { Profile } from "./profile";
import type { RawFriendMeta } from "./friendMeta";

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
