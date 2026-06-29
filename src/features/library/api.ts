// Typed IPC wrappers for the multi-library commands (src-tauri/src/library/
// commands.rs). The Storage manager lists/edits library folders; `moveInstall`
// relocates an installed game to another drive, emitting `library://move-progress`.

import { call } from "../../lib/ipc";
import type { LibraryFolderInfo } from "./types";

/** List every registered library folder with disk + install stats. Always
 *  returns at least the seeded default (`app_data_dir/games`). */
export function listLibraryFolders(): Promise<LibraryFolderInfo[]> {
  return call<LibraryFolderInfo[]>("list_library_folders");
}

/** Register `path` as a new library folder (created on disk if needed). Rejects
 *  an empty path or one that overlaps an existing library folder. */
export function addLibraryFolder(path: string): Promise<void> {
  return call("add_library_folder", { path });
}

/** Unregister `path`. Rejects the default folder and any folder that still holds
 *  installed games (move or uninstall them first). Files on disk are untouched. */
export function removeLibraryFolder(path: string): Promise<void> {
  return call("remove_library_folder", { path });
}

/** Make `path` the default install target for new installs. */
export function setDefaultLibraryFolder(path: string): Promise<void> {
  return call("set_default_library_folder", { path });
}

/** Move an installed game to the library folder `targetPath`. Progress arrives
 *  via the `library://move-progress` event; resolves when the record is rewritten
 *  to the new location. Rejects if the game is downloading or not on disk. */
export function moveInstall(gameId: string, targetPath: string): Promise<void> {
  return call("move_install", { gameId, targetPath });
}
