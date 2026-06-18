// A storefront tab (Steam or Epic): scans locally-installed games on mount and
// renders them as a grid of launch tiles. Reuses the catalog game-card styling.
// In a plain browser (no Tauri) the scan rejects and the empty state shows.

import { useEffect, useState } from "react";
import { launchStoreGame, scanStore, type StoreGame, type StoreSource } from "./api";

const LABELS: Record<StoreSource, string> = { steam: "Steam", epic: "Epic Games" };

export function StoreView({ source }: { source: StoreSource }) {
  const [games, setGames] = useState<StoreGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    scanStore(source)
      .then((g) => {
        if (alive) setGames(g);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [source]);

  return (
    <section className="catalog">
      <div className="catalog__toolbar">
        <span className="catalog__count">{games.length}</span>
        <span className="catalog__status">{LABELS[source]} — installed games</span>
      </div>

      {loading && <p className="catalog__status">Scanning {LABELS[source]} library…</p>}
      {error && <p className="catalog__error">Couldn’t scan {LABELS[source]}: {error}</p>}
      {!loading && !error && games.length === 0 && (
        <p className="catalog__status">
          No installed {LABELS[source]} games found. Install games through {LABELS[source]} and they’ll
          appear here.
        </p>
      )}

      <div className="catalog-grid">
        {games.map((g) => (
          <StoreCard key={g.id} game={g} />
        ))}
      </div>
    </section>
  );
}

function StoreCard({ game }: { game: StoreGame }) {
  // Try the nicer portrait cover first, fall back to the header image, then to a
  // titled placeholder if both 404 (or there's no art, as with Epic).
  const [src, setSrc] = useState(game.coverUrl || game.fallbackUrl);
  const [failed, setFailed] = useState(!game.coverUrl && !game.fallbackUrl);

  return (
    <button
      className="game-card"
      title={`Play ${game.name}`}
      onClick={() => void launchStoreGame(game.launchUri).catch(() => {})}
    >
      <div className="game-card__art">
        {!failed && src ? (
          <img
            src={src}
            alt={game.name}
            loading="lazy"
            onError={() => {
              if (src !== game.fallbackUrl && game.fallbackUrl) setSrc(game.fallbackUrl);
              else setFailed(true);
            }}
          />
        ) : (
          <span className="game-card__placeholder">{game.name}</span>
        )}
      </div>
      <div className="game-card__title">{game.name}</div>
      <div className="game-card__platform">{LABELS[game.source]}</div>
    </button>
  );
}
