// Mirror of the Rust `Game` struct (serde camelCase). Keep field names in sync
// with src-tauri/src/catalog/model.rs — this is the IPC contract.

export interface Game {
  id: string;
  title: string;
  platform: string;
  installState: string;
  coverArtPath: string;
  coverArtUrl: string;
  developer: string;
  publisher: string;
  franchise: string;
  genres: string;
  contentPath: string;
  releaseDate: number;
  playtimeSeconds: number;
  lastPlayed: number;
  serverBacked: boolean;
  favorite: boolean;
  hidden: boolean;
  collections: string;
  launchUri: string;
  exePath: string;
  emulatorPath: string;
  romPath: string;
  arguments: string;
}
