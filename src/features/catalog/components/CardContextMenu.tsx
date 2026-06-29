// Right-click context menu for a game tile: the Steam-style per-game actions
// (Launch / Install / Verify files / Favorite / Hide) anchored at the cursor.
// Pure presentation — every action is a callback supplied by CatalogView; the
// menu just decides which entries make sense for the game's install state. The
// "Verify files" entry mirrors the native launcher's Validate & Repair: it
// re-checks each manifest file by size + SHA-256 and re-downloads mismatches.

import { useEffect, useRef } from "react";
import type { Game } from "../types";

export interface CardMenuTarget {
  game: Game;
  x: number;
  y: number;
}

interface Props {
  target: CardMenuTarget;
  canInstall: boolean;
  onLaunch: (game: Game) => void;
  onInstall: (game: Game) => void;
  onVerify: (game: Game) => void;
  onOpenFolder: (game: Game) => void;
  onMove: (game: Game) => void;
  onToggleFavorite: (game: Game) => void;
  onToggleHidden: (game: Game) => void;
  onClose: () => void;
}

export function CardContextMenu({
  target,
  canInstall,
  onLaunch,
  onInstall,
  onVerify,
  onOpenFolder,
  onMove,
  onToggleFavorite,
  onToggleHidden,
  onClose,
}: Props) {
  const { game } = target;
  const ref = useRef<HTMLDivElement>(null);
  const installed = game.installState === "installed";
  // An update-available game is still fully on disk, so the file actions (open
  // folder, verify integrity) apply to it too — not just the "installed" state.
  const onDisk = installed || game.installState === "updateAvailable";

  // Dismiss on any outside click, scroll, or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  // Keep the menu inside the viewport when opened near an edge.
  const style: React.CSSProperties = {
    left: Math.min(target.x, window.innerWidth - 200),
    top: Math.min(target.y, window.innerHeight - 220),
  };

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div ref={ref} className="card-menu" style={style} role="menu">
      {installed && (
        <button className="card-menu__item" role="menuitem" onClick={run(() => onLaunch(game))}>
          Play
        </button>
      )}
      {canInstall && (
        <button className="card-menu__item" role="menuitem" onClick={run(() => onInstall(game))}>
          {installed ? "Reinstall" : "Install"}
        </button>
      )}
      {onDisk && (
        <button className="card-menu__item" role="menuitem" onClick={run(() => onOpenFolder(game))}>
          Open local folder
        </button>
      )}
      {onDisk && canInstall && (
        <button className="card-menu__item" role="menuitem" onClick={run(() => onVerify(game))}>
          Verify integrity &amp; repair files
        </button>
      )}
      {onDisk && (
        <button className="card-menu__item" role="menuitem" onClick={run(() => onMove(game))}>
          Move install folder…
        </button>
      )}
      <div className="card-menu__sep" />
      <button className="card-menu__item" role="menuitem" onClick={run(() => onToggleFavorite(game))}>
        {game.favorite ? "Remove favorite" : "Add to favorites"}
      </button>
      <button className="card-menu__item" role="menuitem" onClick={run(() => onToggleHidden(game))}>
        {game.hidden ? "Unhide" : "Hide"}
      </button>
    </div>
  );
}
