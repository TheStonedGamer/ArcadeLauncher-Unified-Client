// "Move install folder" prompt: pick the target library for an installed game,
// then watch a live progress bar driven by the `library://move-progress` event.
// The Rust side refuses a move into the folder the game already lives in (and
// while it's downloading), so we can offer every folder and surface any such
// error inline rather than trying to compute the current root in the UI.

import { useState } from "react";
import { formatBytes } from "../download/selectors";
import type { MoveProgress } from "./useMoveProgress";
import type { LibraryFolderInfo } from "./types";

interface Props {
  gameTitle: string;
  folders: LibraryFolderInfo[];
  /** Live progress while a move runs (undefined until one starts). */
  progress?: MoveProgress;
  /** Set once the move finishes or errors. */
  error?: string;
  busy: boolean;
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function MoveLocationModal({
  gameTitle,
  folders,
  progress,
  error,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const [selected, setSelected] = useState(() => folders[0]?.path ?? "");
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
      : 0;
  const moving = busy && !!progress && !progress.done;

  return (
    <div className="detail-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <div className="lib-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h3 className="lib-modal__title">Move {gameTitle}</h3>

        {moving ? (
          <>
            <p className="catalog__status">
              Moving files… {formatBytes(progress.copiedBytes)} of {formatBytes(progress.totalBytes)}
            </p>
            <div className="lib-row__bar" role="progressbar" aria-valuenow={pct}>
              <span className="lib-row__seg lib-row__seg--used" style={{ width: `${pct}%` }} />
            </div>
            <p className="catalog__status">Keep the launcher open until this finishes.</p>
          </>
        ) : (
          <>
            <p className="catalog__status">Choose the library folder to move this game to.</p>
            <ul className="lib-modal__list">
              {folders.map((f) => (
                <li key={f.path}>
                  <label className={`lib-modal__opt${selected === f.path ? " lib-modal__opt--on" : ""}`}>
                    <input
                      type="radio"
                      name="move-location"
                      checked={selected === f.path}
                      onChange={() => setSelected(f.path)}
                    />
                    <span className="lib-modal__optmain">
                      <span className="lib-modal__optpath" title={f.path}>
                        {f.path}
                        {f.isDefault && <span className="lib-row__badge">Default</span>}
                      </span>
                      {f.totalBytes > 0 && (
                        <span className="lib-modal__optfree">
                          {formatBytes(f.freeBytes)} free of {formatBytes(f.totalBytes)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="settings__actions">
              <button className="settings__save" disabled={!selected || busy} onClick={() => onConfirm(selected)}>
                Move here
              </button>
              <button className="lib-row__btn" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
              {error && <span className="catalog__error">{error}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
