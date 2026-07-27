// Mirror of the Rust `Game` struct (serde camelCase). Keep field names in sync
// with src-tauri/src/catalog/model.rs — this is the IPC contract.

export interface Game {
  id: string;
  title: string;
  platform: string;
  installState: string;
  coverArtPath: string;
  coverArtUrl: string;
  /** Wide 1080p key art for banner-sized slots. Optional because a `library.json`
   *  cached by an older client predates the field and games IGDB has no artwork
   *  for carry none; callers fall back to the cover. */
  heroArtUrl?: string;
  developer: string;
  publisher: string;
  franchise: string;
  genres: string;
  contentPath: string;
  releaseDate: number;
  playtimeSeconds: number;
  lastPlayed: number;
  igdbRating: number;
  summary: string;
  serverBacked: boolean;
  favorite: boolean;
  hidden: boolean;
  collections: string;
  launchUri: string;
  exePath: string;
  emulatorPath: string;
  romPath: string;
  arguments: string;
  launchOptions: string;
  preLaunchCmd: string;
  postExitCmd: string;
}
