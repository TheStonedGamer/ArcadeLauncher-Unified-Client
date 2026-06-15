// Detail panel for a variant group: cover + metadata of the representative
// dump, a summary, and (when the group has multiple dumps) a version picker.
// Launching uses the currently selected dump. Esc / backdrop click closes.

import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";
import { yearOf, collectionsOf } from "../query";
import { variantLabel, type VariantGroup } from "../variants";

interface Props {
  group: VariantGroup;
  onLaunch: (game: Game) => void;
  onClose: () => void;
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

export function GameDetail({ group, onLaunch, onClose }: Props) {
  const [pick, setPick] = useState<Game>(group.representative);
  const game = group.representative;
  const cover = game.coverArtPath ? convertFileSrc(game.coverArtPath) : game.coverArtUrl;
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
          <div className="detail__meta">
            <Row label="Platform" value={game.platform} />
            <Row label="Developer" value={game.developer} />
            <Row label="Publisher" value={game.publisher} />
            <Row label="Franchise" value={game.franchise} />
            <Row label="Genres" value={game.genres} />
            <Row label="Year" value={yearOf(game.releaseDate)} />
            <Row label="Rating" value={rating} />
            <Row label="Playtime" value={playtimeStr(game.playtimeSeconds)} />
            <Row label="Collections" value={collectionsOf(game).join(", ")} />
          </div>
          {game.summary && <p className="detail__summary">{game.summary}</p>}

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
