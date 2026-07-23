// Chat attachments, phone side. A deliberate mirror of the desktop client's
// src-tauri/src/social/attach.rs: the same limit, the same MIME table, the same
// rejections. Two implementations of one contract is already one too many, so
// where they must both exist they should at least give the same answers.
//
// Upload is presign -> PUT the bytes to the returned URL -> send a chat frame
// carrying the attachment id. The presign is the only authenticated call; the
// upload URL carries its own signature, so the session token must never be
// attached to it.

/** Largest attachment the server will presign — 25 MiB, matching the server's
 *  ATTACHMENT_MAX_BYTES and the desktop's MAX_ATTACHMENT_BYTES. Checked here so
 *  a photo that is too big fails instantly instead of after a long upload on a
 *  phone connection. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** The last component of a path or content URI, with both separators handled. */
export function basename(path: string): string {
  const cut = path.split(/[/\\]/);
  return cut[cut.length - 1] ?? "";
}

/** Best-effort MIME type from the extension. Unknown types fall back to
 *  application/octet-stream, which the server accepts. */
export function guessContentType(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "txt":
    case "log":
      return "text/plain";
    case "json":
      return "application/json";
    case "zip":
      return "application/zip";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

/** An empty file is rejected because the server's presign requires size > 0. */
export function isAcceptableSize(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= MAX_ATTACHMENT_BYTES;
}

/** Why a picked file cannot be sent, phrased for the user. null = go ahead. */
export function attachmentBlocker(name: string, size: number): string | null {
  if (!basename(name)) return "That file has no name.";
  if (size <= 0) return "That file is empty.";
  if (size > MAX_ATTACHMENT_BYTES) return `Attachments are limited to ${formatSize(MAX_ATTACHMENT_BYTES)}.`;
  return null;
}

/** The presign request body. camelCase to match the desktop's PresignReq, which
 *  is what the server's handler actually reads. */
export interface PresignRequest {
  filename: string;
  contentType: string;
  size: number;
}

export function presignRequest(name: string, size: number): PresignRequest {
  const filename = basename(name);
  return { filename, contentType: guessContentType(filename), size };
}

export interface Presigned {
  attachmentId: number;
  uploadUrl: string;
}

/** Narrow the presign response. Both fields are required: an id with no URL
 *  would leave us sending a chat frame pointing at bytes that were never
 *  uploaded, which is worse than failing here. */
export function parsePresign(value: unknown): Presigned | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const attachmentId = typeof v.attachmentId === "number" ? v.attachmentId : 0;
  const uploadUrl = typeof v.uploadUrl === "string" ? v.uploadUrl : "";
  if (attachmentId <= 0 || !uploadUrl) return null;
  return { attachmentId, uploadUrl };
}

/** Human size, for the picker row and the limit message. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Whether an attachment is worth rendering inline in the chat bubble. */
export function isViewableImage(contentType: string): boolean {
  return contentType.startsWith("image/") && contentType !== "image/svg+xml";
}
