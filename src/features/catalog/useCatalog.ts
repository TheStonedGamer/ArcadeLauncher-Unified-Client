// Catalog state hook: owns loading games from a path and launching them, with
// loading/error flags. Keeping this out of the view component means the grid is
// pure presentation and easy to test/replace.

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadCatalog, fetchCatalog, launchGame } from "./api";
import { setIdle, setPlaying } from "../presence/api";
import type { Game } from "./types";

// Emitted by Rust when a launched game exits (see launch/session.rs).
interface GameExited {
  id: string;
  title: string;
  playtimeSeconds: number;
  exitOk: boolean;
}

export interface CatalogState {
  games: Game[];
  loading: boolean;
  error: string | null;
  status: string | null;
  load: (path?: string) => Promise<void>;
  /** Refresh the catalog from the server (caches to library.json), then show it. */
  syncFromServer: (host: string, token: string) => Promise<void>;
  launch: (game: Game) => Promise<void>;
  /** Update one game's cover path in-memory (after a cover fetch). */
  setCover: (id: string, coverArtPath: string) => void;
}

// Browser-preview seed: `?catalog-demo` populates a handful of games (some with
// playtime/lastPlayed) so UI like the "Continue Playing" row is visible without a
// Tauri backend. Never hit on the shipping path (no query param in the app).
function seedCatalogDemo(): Game[] {
  const now = Math.floor(Date.now() / 1000);
  const base = (id: string, title: string, platform: string): Game => ({
    id, title, platform, installState: "installed",
    coverArtPath: "", coverArtUrl: "", developer: "", publisher: "", franchise: "",
    genres: "", contentPath: "", releaseDate: 0, playtimeSeconds: 0, lastPlayed: 0,
    igdbRating: 0, summary: "", serverBacked: false, favorite: false, hidden: false,
    collections: "", launchUri: "", exePath: "", emulatorPath: "", romPath: "",
    arguments: "", launchOptions: "", preLaunchCmd: "", postExitCmd: "",
  });
  return [
    { ...base("z", "The Legend of Zelda", "NES"), playtimeSeconds: 12 * 3600 + 5 * 60, lastPlayed: now - 3600 },
    { ...base("m", "Super Metroid", "SNES"), playtimeSeconds: 6 * 3600, lastPlayed: now - 2 * 86400 },
    { ...base("h", "Halo: Combat Evolved", "Xbox"), playtimeSeconds: 45 * 60, lastPlayed: now - 9 * 86400 },
    { ...base("c", "Crystalis", "NES"), playtimeSeconds: 3 * 3600 + 30 * 60, lastPlayed: now - 20 * 86400 },
    { ...base("o", "Ocarina of Time", "N64"), playtimeSeconds: 22 * 3600, lastPlayed: now - 40 * 86400 },
    base("u", "Unplayed Game", "PC"),
  ];
}

export function useCatalog(): CatalogState {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // When a game exits, fold its session time into the matching entry so the
  // grid/detail playtime updates without a reload.
  useEffect(() => {
    const unlisten = listen<GameExited>("game-exited", (event) => {
      const { id, title, playtimeSeconds } = event.payload;
      setGames((prev) =>
        prev.map((g) =>
          g.id === id
            ? { ...g, playtimeSeconds: g.playtimeSeconds + playtimeSeconds, lastPlayed: Math.floor(Date.now() / 1000) }
            : g,
        ),
      );
      const mins = Math.max(1, Math.round(playtimeSeconds / 60));
      setStatus(`"${title}" exited — +${mins} min playtime`);
      // Game over → drop Discord presence back to idle.
      void setIdle();
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  const load = useCallback(async (path?: string) => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("catalog-demo")) {
      const demo = seedCatalogDemo();
      setGames(demo);
      setStatus(`Loaded ${demo.length} demo games`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await loadCatalog(path);
      setGames(result);
      setStatus(`Loaded ${result.length} game${result.length === 1 ? "" : "s"}`);
    } catch (e) {
      setError(String(e));
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull the latest catalog from the server. On failure we keep whatever the
  // local library.json already gave us (offline-friendly) and surface the error.
  const syncFromServer = useCallback(async (host: string, token: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalog(host, token);
      setGames(result);
      setStatus(`Synced ${result.length} game${result.length === 1 ? "" : "s"} from server`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const launch = useCallback(async (game: Game) => {
    setError(null);
    try {
      const pid = await launchGame(game);
      setStatus(`Launched "${game.title}" (pid ${pid})`);
      // Announce now-playing to Discord (best-effort, settings-gated in Rust).
      void setPlaying(game.title);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const setCover = useCallback((id: string, coverArtPath: string) => {
    setGames((prev) => prev.map((g) => (g.id === id ? { ...g, coverArtPath } : g)));
  }, []);

  return { games, loading, error, status, load, syncFromServer, launch, setCover };
}
