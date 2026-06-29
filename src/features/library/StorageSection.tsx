// Settings → Storage: the Steam-style library-folder manager. Lists each
// registered install root with a usage bar (this launcher's installs vs. the
// drive's free space), the default badge, and Add / Set default / Remove
// actions. Add uses the native folder picker; Remove is blocked while a folder
// holds installs or is the default (enforced again Rust-side).

import { useCallback, useEffect, useState } from "react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { formatBytes } from "../download/selectors";
import {
  addLibraryFolder,
  listLibraryFolders,
  removeLibraryFolder,
  setDefaultLibraryFolder,
} from "./api";
import type { LibraryFolderInfo } from "./types";

export function StorageSection() {
  const [folders, setFolders] = useState<LibraryFolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setFolders(await listLibraryFolders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Run a mutating action, then refresh; surface its error inline.
  const act = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError("");
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const addFolder = useCallback(async () => {
    // Native folder picker (already-bundled dialog plugin). A cancel returns null.
    const picked = await openFolderDialog({ directory: true, multiple: false });
    if (typeof picked !== "string" || picked.trim() === "") return;
    await act(() => addLibraryFolder(picked));
  }, [act]);

  return (
    <>
      <h2 className="settings__heading">Storage</h2>
      <p className="catalog__status">
        Choose where games install. Add a library folder on any drive, set which one new installs go
        to, and move installed games between drives from a game’s right-click menu.
      </p>

      {loading && <p className="catalog__status">Loading libraries…</p>}

      {!loading && (
        <ul className="lib-list">
          {folders.map((f) => (
            <LibraryFolderRow
              key={f.path}
              folder={f}
              busy={busy}
              onSetDefault={() => void act(() => setDefaultLibraryFolder(f.path))}
              onRemove={() => void act(() => removeLibraryFolder(f.path))}
            />
          ))}
        </ul>
      )}

      <div className="settings__actions">
        <button className="settings__save" onClick={() => void addFolder()} disabled={busy}>
          Add library folder…
        </button>
        <button className="settings__save" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        {error && <span className="catalog__error">{error}</span>}
      </div>
    </>
  );
}

function LibraryFolderRow({
  folder,
  busy,
  onSetDefault,
  onRemove,
}: {
  folder: LibraryFolderInfo;
  busy: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const { path, isDefault, freeBytes, totalBytes, usedBytes, gameCount } = folder;
  // Usage bar: the slice this launcher's installs occupy vs. the whole volume.
  // Falls back to a hidden bar when the volume size is unknown.
  const usedPct = totalBytes > 0 ? Math.min(100, (usedBytes / totalBytes) * 100) : 0;
  const otherPct =
    totalBytes > 0 ? Math.max(0, Math.min(100 - usedPct, ((totalBytes - freeBytes - usedBytes) / totalBytes) * 100)) : 0;
  const canRemove = !isDefault && gameCount === 0;
  const removeTitle = isDefault
    ? "Can’t remove the default library"
    : gameCount > 0
      ? "Move or uninstall this library’s games first"
      : "Remove this library folder";

  return (
    <li className="lib-row">
      <div className="lib-row__head">
        <span className="lib-row__path" title={path}>
          {path}
        </span>
        {isDefault && <span className="lib-row__badge">Default</span>}
      </div>

      {totalBytes > 0 && (
        <div className="lib-row__bar" role="img" aria-label={`${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)}`}>
          {/* other apps' usage (dim) then this launcher's installs (accent). */}
          <span className="lib-row__seg lib-row__seg--other" style={{ width: `${otherPct}%` }} />
          <span className="lib-row__seg lib-row__seg--used" style={{ width: `${usedPct}%` }} />
        </div>
      )}

      <div className="lib-row__meta">
        <span>
          {gameCount} game{gameCount === 1 ? "" : "s"} · {formatBytes(usedBytes)} used by ArcadeLauncher
        </span>
        {totalBytes > 0 && (
          <span>
            {formatBytes(freeBytes)} free of {formatBytes(totalBytes)}
          </span>
        )}
      </div>

      <div className="lib-row__actions">
        {!isDefault && (
          <button className="lib-row__btn" disabled={busy} onClick={onSetDefault}>
            Set as default
          </button>
        )}
        <button className="lib-row__btn" disabled={busy || !canRemove} title={removeTitle} onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}
