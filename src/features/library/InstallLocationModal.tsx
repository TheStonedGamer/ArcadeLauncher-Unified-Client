// Steam-style "choose a library folder" prompt, shown on install only when more
// than one library folder exists. A radio list of folders with free space; the
// default is preselected. Confirms with the chosen install root.

import { useState } from "react";
import { formatBytes } from "../download/selectors";
import type { LibraryFolderInfo } from "./types";

interface Props {
  gameTitle: string;
  folders: LibraryFolderInfo[];
  onConfirm: (path: string) => void;
  onCancel: () => void;
}

export function InstallLocationModal({ gameTitle, folders, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState(
    () => folders.find((f) => f.isDefault)?.path ?? folders[0]?.path ?? "",
  );

  return (
    <div className="detail-backdrop" onMouseDown={onCancel}>
      <div className="lib-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h3 className="lib-modal__title">Install {gameTitle}</h3>
        <p className="catalog__status">Choose which library folder to install into.</p>

        <ul className="lib-modal__list">
          {folders.map((f) => (
            <li key={f.path}>
              <label className={`lib-modal__opt${selected === f.path ? " lib-modal__opt--on" : ""}`}>
                <input
                  type="radio"
                  name="install-location"
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
          <button className="settings__save" disabled={!selected} onClick={() => onConfirm(selected)}>
            Install here
          </button>
          <button className="lib-row__btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
