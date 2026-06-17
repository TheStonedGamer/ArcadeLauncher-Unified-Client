// General settings form bound to useSettings. Edits are kept in a draft and
// persisted to config.json on Save.

import { useSettings } from "./useSettings";

export function SettingsView() {
  const { draft, loading, saved, error, set, save } = useSettings();

  if (loading) return <p className="catalog__status">Loading settings…</p>;

  return (
    <section className="settings">
      <h2 className="settings__heading">General</h2>

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

      <h2 className="settings__heading">Cover art (IGDB)</h2>
      <p className="catalog__status">
        Optional. Create a Twitch application to get a client id/secret, then ArcadeLauncher can fetch
        missing covers from IGDB.
      </p>
      <label className="settings__field">
        <span className="settings__label">Twitch client id</span>
        <input
          className="settings__input"
          value={draft.igdbClientId}
          onChange={(e) => set("igdbClientId", e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="settings__field">
        <span className="settings__label">Twitch client secret</span>
        <input
          className="settings__input"
          type="password"
          value={draft.igdbClientSecret}
          onChange={(e) => set("igdbClientSecret", e.target.value)}
          spellCheck={false}
        />
      </label>

      <h2 className="settings__heading">Discord Rich Presence</h2>
      <p className="catalog__status">
        Show the game you're playing in your Discord status. Create a Discord application to get an
        application id, then turn this on.
      </p>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={draft.discordRichPresence}
          onChange={(e) => set("discordRichPresence", e.target.checked)}
        />
        Show current game in Discord
      </label>
      <label className="settings__field">
        <span className="settings__label">Discord application id</span>
        <input
          className="settings__input"
          value={draft.discordAppId}
          onChange={(e) => set("discordAppId", e.target.value)}
          placeholder="Discord application (client) id"
          spellCheck={false}
        />
      </label>

      <h2 className="settings__heading">Global hotkey</h2>
      <p className="catalog__status">
        Summon or hide ArcadeLauncher from anywhere with a keyboard shortcut (e.g. while in a game).
      </p>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={draft.globalHotkeyEnabled}
          onChange={(e) => set("globalHotkeyEnabled", e.target.checked)}
        />
        Enable global summon/hide hotkey
      </label>
      <label className="settings__field">
        <span className="settings__label">Shortcut</span>
        <input
          className="settings__input"
          value={draft.globalHotkey}
          onChange={(e) => set("globalHotkey", e.target.value)}
          placeholder="Ctrl+Shift+G"
          spellCheck={false}
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
