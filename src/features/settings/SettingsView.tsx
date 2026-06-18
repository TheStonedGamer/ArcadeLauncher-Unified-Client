// General settings form bound to useSettings. Edits are kept in a draft and
// persisted to config.json on Save.

import { useSettings } from "./useSettings";
import { useSession } from "../session/SessionContext";
import { useEmulators } from "../emulators/useEmulators";
import { formatBytes } from "../download/selectors";
import type { EmulatorProgress, EmulatorStatus } from "../emulators/api";

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

      <h2 className="settings__heading">Discord Rich Presence</h2>
      <p className="catalog__status">
        Show the game you're playing in your Discord status. The Discord application is configured on
        the server — just turn this on.
      </p>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={draft.discordRichPresence}
          onChange={(e) => set("discordRichPresence", e.target.checked)}
        />
        Show current game in Discord
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

      <EmulatorsSection />
    </section>
  );
}

/** Shows which server-hosted emulator runtimes are staged locally ("Ready") and
 *  lets the user download the rest. Independent of the General settings draft. */
function EmulatorsSection() {
  const { session } = useSession();
  const { emulators, loading, error, progress, refresh, download } = useEmulators(
    session?.host ?? null,
    session?.token ?? null,
  );

  return (
    <>
      <h2 className="settings__heading">Emulators</h2>
      <p className="catalog__status">
        Emulator runtimes hosted by your server. “Ready” means the runtime is fully downloaded on
        this PC.
      </p>

      {!session && <p className="catalog__status">Sign in to see and download emulators.</p>}
      {session && loading && <p className="catalog__status">Checking emulators…</p>}
      {session && error && <p className="catalog__error">Couldn’t load emulators: {error}</p>}
      {session && !loading && !error && emulators.length === 0 && (
        <p className="catalog__status">No emulators are hosted on the server yet.</p>
      )}

      {session && emulators.length > 0 && (
        <ul className="emu-list">
          {emulators.map((emu) => (
            <EmulatorRow key={emu.id} emu={emu} progress={progress[emu.id]} onDownload={download} />
          ))}
        </ul>
      )}

      {session && emulators.length > 0 && (
        <div className="settings__actions">
          <button className="settings__save" onClick={refresh}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}

function EmulatorRow({
  emu,
  progress,
  onDownload,
}: {
  emu: EmulatorStatus;
  progress?: EmulatorProgress;
  onDownload: (id: string) => void;
}) {
  // Actively staging when we have progress that isn't finished.
  const staging = !!progress && !progress.done;
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : 0;
  const failed = progress?.done && !!progress.error;

  return (
    <li className="emu-row">
      <span className={`emu-row__dot emu-row__dot--${emu.ready ? "on" : "off"}`} aria-hidden />
      <span className="emu-row__name">{emu.name}</span>
      <span className="emu-row__size">{formatBytes(emu.totalBytes)}</span>

      {emu.ready ? (
        <span className="emu-row__ready">Ready ✓</span>
      ) : staging ? (
        <span className="emu-row__progress" role="progressbar" aria-valuenow={pct}>
          <span className="emu-row__bar" style={{ width: `${pct}%` }} />
          <span className="emu-row__pct">{pct}%</span>
        </span>
      ) : (
        <button className="emu-row__btn" onClick={() => onDownload(emu.id)}>
          {failed ? "Retry" : "Download"}
        </button>
      )}

      {failed && <span className="catalog__error emu-row__err">{progress?.error}</span>}
    </li>
  );
}
