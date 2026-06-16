// Download-queue domain types. The status strings mirror the Rust
// `DownloadStatus` (snake_case serde) exactly, and the two event shapes mirror
// the payloads the engine emits on `download://progress` / `download://status`
// (src-tauri/src/download/engine.rs). Keeping them in one place means the wire
// contract has a single source of truth on the TS side, the way the social
// protocol types do.

/** Lifecycle of one game's install, matching the Rust enum. */
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "verifying"
  | "extracting"
  | "done"
  | "failed"
  | "paused";

/** Payload of a `download://progress` event (Progress flattened + game id). */
export interface ProgressEvent {
  gameId: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
}

/** Payload of a `download://status` event. */
export interface StatusEvent {
  gameId: string;
  status: DownloadStatus;
  error?: string;
}

/** The UI-side view of one install: byte counts plus a smoothed speed estimate. */
export interface DownloadItem {
  gameId: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  /** Last failure message, if the item is `failed`. */
  error?: string;
  /** Smoothed transfer rate in bytes/sec (0 unless actively downloading). */
  speedBps: number;
  /** epoch ms of the last progress sample (for the next speed delta). */
  sampledAt: number;
  /** downloadedBytes at the last sample. */
  sampledBytes: number;
}
