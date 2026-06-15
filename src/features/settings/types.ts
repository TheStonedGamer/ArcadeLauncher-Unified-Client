// Mirror of the Rust `General` settings struct (serde camelCase). Keep in sync
// with src-tauri/src/settings/model.rs.

export interface GeneralSettings {
  libraryPath: string;
  closeToTray: boolean;
  launchMinimized: boolean;
  confirmOnExit: boolean;
  downloadLimitKbps: number;
  concurrentDownloads: number;
  theme: string;
}
