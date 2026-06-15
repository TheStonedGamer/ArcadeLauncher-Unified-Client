// General settings form bound to useSettings. Edits are kept in a draft and
// persisted to config.json on Save.

import { useSettings } from "./useSettings";

export function SettingsView() {
  const { draft, loading, saved, error, set, save } = useSettings();

  if (loading) return <p className="catalog__status">Loading settings…</p>;

  return (
    <section className="settings">
      <h2 className="settings__heading">General</h2>

      <label className="settings__field">
        <span className="settings__label">Library file (library.json)</span>
        <input
          className="settings__input"
          value={draft.libraryPath}
          onChange={(e) => set("libraryPath", e.target.value)}
          placeholder="Path to your library.json"
          spellCheck={false}
        />
      </label>

      <label className="settings__check">
        <input type="checkbox" checked={draft.closeToTray} onChange={(e) => set("closeToTray", e.target.checked)} />
        Minimize to tray on close
      </label>
      <label className="settings__check">
        <input type="checkbox" checked={draft.launchMinimized} onChange={(e) => set("launchMinimized", e.target.checked)} />
        Start minimized
      </label>
      <label className="settings__check">
        <input type="checkbox" checked={draft.confirmOnExit} onChange={(e) => set("confirmOnExit", e.target.checked)} />
        Confirm before exit
      </label>

      <label className="settings__field">
        <span className="settings__label">Download limit (KB/s, 0 = unlimited)</span>
        <input
          className="settings__input settings__input--num"
          type="number"
          min={0}
          value={draft.downloadLimitKbps}
          onChange={(e) => set("downloadLimitKbps", Number(e.target.value) || 0)}
        />
      </label>
      <label className="settings__field">
        <span className="settings__label">Concurrent downloads</span>
        <input
          className="settings__input settings__input--num"
          type="number"
          min={1}
          value={draft.concurrentDownloads}
          onChange={(e) => set("concurrentDownloads", Number(e.target.value) || 1)}
        />
      </label>

      <div className="settings__actions">
        <button className="settings__save" onClick={save}>
          Save
        </button>
        {saved && <span className="settings__saved">Saved ✓</span>}
        {error && <span className="catalog__error">{error}</span>}
      </div>
    </section>
  );
}
