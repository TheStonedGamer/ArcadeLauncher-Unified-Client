// Types for multi-library (multi-drive) storage support. Mirror the Rust
// `LibraryFolderInfo` (library/commands.rs) and the `library://move-progress`
// event payload.

/** One registered library folder, enriched with disk + install stats. */
export interface LibraryFolderInfo {
  /** Absolute install-root path. */
  path: string;
  /** Whether new installs default here. Exactly one folder is the default. */
  isDefault: boolean;
  /** Free bytes on the volume (0 if it couldn't be queried). */
  freeBytes: number;
  /** Total bytes on the volume (0 if it couldn't be queried). */
  totalBytes: number;
  /** Number of this launcher's installed games living under this folder. */
  gameCount: number;
  /** Bytes those installs occupy (summed from install records). */
  usedBytes: number;
}

/** Progress for an in-flight cross-drive move (`library://move-progress`). */
export interface MoveProgressEvent {
  gameId: string;
  copiedBytes: number;
  totalBytes: number;
  done: boolean;
}
