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
  const [selected, setSelected] = useState<StoreGame | null>(null);

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
          <StoreCard key={g.id} game={g} onOpen={() => setSelected(g)} />
        ))}
      </div>

      {selected && (
        <StoreGameDetail
          game={selected}
          onLaunch={() => {
            void launchStoreGame(selected.launchUri).catch(() => {});
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

/** Cover art with the same portrait→header→placeholder fallback used on cards,
 *  reused by both the grid tile and the detail modal. */
function StoreArt({ game, alt }: { game: StoreGame; alt: string }) {
  const [src, setSrc] = useState(game.coverUrl || game.fallbackUrl);
  const [failed, setFailed] = useState(!game.coverUrl && !game.fallbackUrl);
  if (failed || !src) return <span className="game-card__placeholder">{game.name}</span>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (src !== game.fallbackUrl && game.fallbackUrl) setSrc(game.fallbackUrl);
        else setFailed(true);
      }}
    />
  );
}

function StoreCard({ game, onOpen }: { game: StoreGame; onOpen: () => void }) {
  return (
    <button className="game-card" title={game.name} onClick={onOpen}>
      <div className="game-card__art">
        <StoreArt game={game} alt={game.name} />
      </div>
      <div className="game-card__title">{game.name}</div>
      <div className="game-card__platform">{LABELS[game.source]}</div>
    </button>
  );
}

/** Info popup for a store game, mirroring the catalog's GameDetail layout but
 *  with the metadata a storefront scan actually has (source + install folder)
 *  and a single Play action that launches via the storefront protocol. */
function StoreGameDetail({
  game,
  onLaunch,
  onClose,
}: {
  game: StoreGame;
  onLaunch: () => void;
  onClose: () => void;
}) {
  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail" onClick={(e) => e.stopPropagation()}>
        <button className="detail__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="detail__cover">
          <StoreArt game={game} alt={game.name} />
        </div>
        <div className="detail__body">
          <h2 className="detail__title">{game.name}</h2>
          <div className="detail__meta">
            <div className="detail__row">
              <span className="detail__key">Source</span>
              <span className="detail__val">{LABELS[game.source]}</span>
            </div>
            {game.installDir && (
              <div className="detail__row">
                <span className="detail__key">Installed at</span>
                <span className="detail__val">{game.installDir}</span>
              </div>
            )}
          </div>
          <button className="detail__launch" onClick={onLaunch}>
            ▶ Play
          </button>
        </div>
      </div>
    </div>
  );
}
