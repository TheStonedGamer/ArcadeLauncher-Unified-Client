// Catalog state hook: owns loading games from a path and launching them, with
// loading/error flags. Keeping this out of the view component means the grid is
// pure presentation and easy to test/replace.

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadCatalog, launchGame } from "./api";
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
  launch: (game: Game) => Promise<void>;
  /** Update one game's cover path in-memory (after a cover fetch). */
  setCover: (id: string, coverArtPath: string) => void;
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

  return { games, loading, error, status, load, launch, setCover };
}
