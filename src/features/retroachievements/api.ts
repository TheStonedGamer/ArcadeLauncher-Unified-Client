// Typed IPC for the RetroAchievements command (src-tauri/src/retroachievements/
// commands.rs). Fetches the signed-in user's RA score/rank + recent unlocks via
// the RA Web API, authed with the username + key from General settings.

import { call } from "../../lib/ipc";

/** One recently-unlocked achievement. Mirrors the Rust `Unlock`. */
export interface RaUnlock {
  title: string;
  description: string;
  points: number;
  gameTitle: string;
  /** Server-formatted unlock timestamp (`YYYY-MM-DD HH:MM:SS`). */
  date: string;
  hardcore: boolean;
}

/** The combined RA summary. Mirrors the Rust `RaSummary`. */
export interface RaSummary {
  username: string;
  score: number;
  rank: number;
  totalRanked: number;
  recent: RaUnlock[];
}

/** Fetch the user's RetroAchievements summary. Rejects when creds are missing or
 *  the request fails. */
export function fetchRaSummary(username: string, apiKey: string): Promise<RaSummary> {
  return call<RaSummary>("retroachievements_summary", { username, apiKey });
}
