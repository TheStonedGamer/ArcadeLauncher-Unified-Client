// Detail panel for a variant group: cover + metadata of the representative
// dump, a summary, and (when the group has multiple dumps) a version picker.
// Launching uses the currently selected dump. Esc / backdrop click closes.

import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";
import { yearOf, collectionsOf } from "../query";
import { needsArt } from "../api";
import { variantLabel, type VariantGroup } from "../variants";

interface Props {
  group: VariantGroup;
  onLaunch: (game: Game) => void;
  onClose: () => void;
  /** Fetch a cover for the game; resolves to the new path or null. Absent when
   *  IGDB credentials aren't configured. */
  onFetchCover?: (game: Game) => Promise<string | null>;
  onToggleFavorite?: (game: Game) => void;
  onToggleHidden?: (game: Game) => void;
  onAddCollection?: (game: Game, name: string) => void;
  onRemoveCollection?: (game: Game, name: string) => void;
}

function playtimeStr(seconds: number): string {
  if (!seconds) return "Never played";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="detail__row">
      <span className="detail__key">{label}</span>
      <span className="detail__val">{value}</span>
    </div>
  );
}

export function GameDetail({
  group,
  onLaunch,
  onClose,
  onFetchCover,
  onToggleFavorite,
  onToggleHidden,
  onAddCollection,
  onRemoveCollection,
}: Props) {
  const [pick, setPick] = useState<Game>(group.representative);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [coverPath, setCoverPath] = useState(group.representative.coverArtPath);
  const game = group.representative;
  const cover = coverPath ? convertFileSrc(coverPath) : game.coverArtUrl;

  // Local mirrors of the overridable bits so toggles reflect immediately in the
  // open modal (the grid re-derives from prefs on close).
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(game.hidden);
  const [collections, setCollections] = useState<string[]>(collectionsOf(game));
  const [newCollection, setNewCollection] = useState("");

  const toggleFavorite = () => {
    onToggleFavorite?.(game);
    setFavorite((v) => !v);
  };
  const toggleHidden = () => {
    onToggleHidden?.(game);
    setHidden((v) => !v);
  };
  const addCollection = () => {
    const name = newCollection.trim();
    if (!name || collections.includes(name)) return;
    onAddCollection?.(game, name);
    setCollections((c) => [...c, name]);
    setNewCollection("");
  };
  const removeCollection = (name: string) => {
    onRemoveCollection?.(game, name);
    setCollections((c) => c.filter((x) => x !== name));
  };

  const fetchCover = async () => {
    if (!onFetchCover) return;
    setFetching(true);
    setFetchMsg("");
    const path = await onFetchCover(game).catch(() => null);
    setFetching(false);
    if (path) {
      setCoverPath(path);
      setFetchMsg("Cover updated ✓");
    } else {
      setFetchMsg("No cover found — check your IGDB credentials in Settings.");
    }
  };
  const rating = game.igdbRating >= 1 ? `${Math.round(game.igdbRating)}/100` : "";
  const hasVariants = group.members.length > 1;

  return (
    <div className="detail-backdrop" onClick={onClose}>
      <div className="detail" onClick={(e) => e.stopPropagation()}>
        <button className="detail__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="detail__cover">
          {cover ? <img src={cover} alt={game.title} /> : <span>{game.title}</span>}
        </div>
        <div className="detail__body">
          <h2 className="detail__title">{game.title}</h2>

          {(onToggleFavorite || onToggleHidden) && (
            <div className="detail__actions">
              {onToggleFavorite && (
                <button
                  className={`detail__toggle${favorite ? " detail__toggle--on" : ""}`}
                  onClick={toggleFavorite}
                >
                  {favorite ? "★ Favorited" : "☆ Favorite"}
                </button>
              )}
              {onToggleHidden && (
                <button className="detail__toggle" onClick={toggleHidden}>
                  {hidden ? "🙈 Hidden" : "Hide"}
                </button>
              )}
            </div>
          )}

          <div className="detail__meta">
            <Row label="Platform" value={game.platform} />
            <Row label="Developer" value={game.developer} />
            <Row label="Publisher" value={game.publisher} />
            <Row label="Franchise" value={game.franchise} />
            <Row label="Genres" value={game.genres} />
            <Row label="Year" value={yearOf(game.releaseDate)} />
            <Row label="Rating" value={rating} />
            <Row label="Playtime" value={playtimeStr(game.playtimeSeconds)} />
          </div>
          {game.summary && <p className="detail__summary">{game.summary}</p>}

          {onAddCollection && (
            <div className="detail__collections">
              <span className="settings__label">Collections</span>
              <div className="detail__chips">
                {collections.map((c) => (
                  <span key={c} className="detail__chip">
                    {c}
                    <button
                      className="detail__chip-x"
                      onClick={() => removeCollection(c)}
                      aria-label={`Remove from ${c}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {collections.length === 0 && <span className="detail__fetchmsg">None yet</span>}
              </div>
              <div className="detail__collection-add">
                <input
                  className="settings__input"
                  value={newCollection}
                  onChange={(e) => setNewCollection(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCollection()}
                  placeholder="Add to collection…"
                  spellCheck={false}
                />
                <button className="detail__fetch" onClick={addCollection} disabled={!newCollection.trim()}>
                  Add
                </button>
              </div>
            </div>
          )}

          {onFetchCover && needsArt(game) && (
            <div className="detail__art">
              <button className="detail__fetch" onClick={fetchCover} disabled={fetching}>
                {fetching ? "Fetching…" : "Fetch cover from IGDB"}
              </button>
              {fetchMsg && <span className="detail__fetchmsg">{fetchMsg}</span>}
            </div>
          )}

          {hasVariants && (
            <div className="detail__variants">
              <span className="settings__label">Version</span>
              <div className="detail__variant-list">
                {group.members.map((m, i) => {
                  const lbl = variantLabel(m) || "Base";
                  return (
                    <button
                      key={m.id || i}
                      className={`detail__variant${m === pick ? " detail__variant--active" : ""}`}
                      onClick={() => setPick(m)}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button className="detail__launch" onClick={() => onLaunch(pick)}>
            ▶ Launch{hasVariants ? ` ${variantLabel(pick) || "Base"}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
