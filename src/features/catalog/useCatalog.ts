// Catalog state hook: owns loading games from a path and launching them, with
// loading/error flags. Keeping this out of the view component means the grid is
// pure presentation and easy to test/replace.

import { useCallback, useState } from "react";
import { loadCatalog, launchGame } from "./api";
import type { Game } from "./types";

export interface CatalogState {
  games: Game[];
  loading: boolean;
  error: string | null;
  status: string | null;
  load: (path: string) => Promise<void>;
  launch: (game: Game) => Promise<void>;
}

export function useCatalog(): CatalogState {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (path: string) => {
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
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { games, loading, error, status, load, launch };
}
