// Typed IPC wrappers for the DM-attachment commands (src-tauri/src/social/
// commands.rs). The Rust side does the presign → PUT-bytes upload and the
// presigned-download lookup, all authed with the session token; bytes never
// transit the webview. These wrappers are the thin frontend seam.

import { call } from "../../lib/ipc";

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
