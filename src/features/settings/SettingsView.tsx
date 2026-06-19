// General settings form bound to useSettings. Edits are kept in a draft and
// persisted to config.json on Save.

import { useCallback } from "react";
import { useSettings } from "./useSettings";
import { useSession } from "../session/SessionContext";
import { useEmulators } from "../emulators/useEmulators";
import { formatBytes } from "../download/selectors";
import type { EmulatorProgress, EmulatorStatus, FirmwareStatus } from "../emulators/api";
import { useGamepadConnected } from "../gamepad/useGamepadConnected";
import { clampDeadZone, useControllerConfig } from "../gamepad/ControllerConfigContext";
import { EmulatorControllerEditor } from "../controller/EmulatorControllerEditor";
import { ThemeSettings } from "../theme/ThemeSettings";

export function SettingsView() {
  const { draft, loading, saved, error, set, save } = useSettings();
  const { refresh: refreshController } = useControllerConfig();

  // Re-read controller prefs into the live context after a save so an
  // enable/dead-zone change applies without restarting the app.
  const onSave = useCallback(async () => {
    await save();
    await refreshController();
  }, [save, refreshController]);

  if (loading) return <p className="catalog__status">Loading settings…</p>;

  return (
    <section className="settings">
      <ThemeSettings />

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

      <ControllerSection
        enabled={draft.controllerEnabled}
        deadZone={draft.controllerDeadZone}
        onToggle={(v) => set("controllerEnabled", v)}
        onDeadZone={(v) => set("controllerDeadZone", v)}
      />

      <label className="settings__field">
        <span className="settings__label">SteamGridDB API key (for the cover-art picker)</span>
        <input
          className="settings__input"
          type="password"
          value={draft.steamgriddbApiKey}
          onChange={(e) => set("steamgriddbApiKey", e.target.value)}
          placeholder="Paste your key from steamgriddb.com/profile/preferences/api"
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="settings__actions">
        <button className="settings__save" onClick={onSave}>
          Save
        </button>
        {saved && <span className="settings__saved">Saved ✓</span>}
        {error && <span className="catalog__error">{error}</span>}
      </div>

      <EmulatorsSection />

      <EmulatorControllerEditor />
    </section>
  );
}

/** The button→action map shown read-only so users know the bindings without a
 *  controller plugged in. Mirrors `diffIntents` in gamepad/input.ts. */
const CONTROLLER_BINDINGS: { btn: string; action: string }[] = [
  { btn: "A", action: "Select / launch" },
  { btn: "B", action: "Back" },
  { btn: "X", action: "Context menu" },
  { btn: "Y", action: "Search" },
  { btn: "LB / RB", action: "Previous / next tab" },
  { btn: "LT / RT", action: "Page up / down" },
  { btn: "D-pad / Left stick", action: "Move" },
  { btn: "Start", action: "Open Settings" },
  { btn: "Guide", action: "Toggle Big Picture" },
];

/** Controller/gamepad navigation: enable toggle, stick dead-zone tuning, live
 *  connection status, and the (currently fixed) button map for reference. */
function ControllerSection({
  enabled,
  deadZone,
  onToggle,
  onDeadZone,
}: {
  enabled: boolean;
  deadZone: number;
  onToggle: (value: boolean) => void;
  onDeadZone: (value: number) => void;
}) {
  const connected = useGamepadConnected();

  return (
    <>
      <h2 className="settings__heading">Controller</h2>
      <p className="catalog__status">
        Navigate the launcher with a gamepad. Status:{" "}
        <strong>{connected ? "controller connected" : "no controller detected"}</strong>.
      </p>

      <label className="settings__check">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Enable controller navigation
      </label>

      <label className="settings__field">
        <span className="settings__label">
          Stick dead zone: {Math.round(deadZone * 100)}%
        </span>
        <input
          className="settings__input settings__input--range"
          type="range"
          min={5}
          max={95}
          step={5}
          disabled={!enabled}
          value={Math.round(deadZone * 100)}
          onChange={(e) => onDeadZone(clampDeadZone(Number(e.target.value) / 100))}
        />
      </label>
      <p className="catalog__status">
        Lower = the stick reacts to smaller movements; raise it if the cursor drifts on its own.
      </p>

      <h3 className="emu-group">Button map</h3>
      <ul className="cc-bindings">
        {CONTROLLER_BINDINGS.map((b) => (
          <li key={b.btn} className="cc-bindings__row">
            <span className="cc-bindings__btn">{b.btn}</span>
            <span className="cc-bindings__action">{b.action}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Shows which server-hosted emulator runtimes are staged locally ("Ready") and
 *  lets the user download the rest. Independent of the General settings draft. */
function EmulatorsSection() {
  const { session } = useSession();
  const { emulators, firmware, loading, error, progress, refresh, download, downloadAll } =
    useEmulators(session?.host ?? null, session?.token ?? null);

  const allReady = emulators.length > 0 && emulators.every((e) => e.ready);

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
        <>
          <EmulatorGroup
            label="Emulators"
            items={emulators.filter((e) => e.kind !== "firmware")}
            progress={progress}
            onDownload={download}
          />
          <EmulatorGroup
            label="Firmware & BIOS"
            items={emulators.filter((e) => e.kind === "firmware")}
            progress={progress}
            onDownload={download}
          />
        </>
      )}

      <FirmwareStatusGroup firmware={firmware} />

      {session && emulators.length > 0 && (
        <div className="settings__actions">
          <button className="settings__save" onClick={downloadAll} disabled={allReady}>
            {allReady ? "All downloaded ✓" : "Download all"}
          </button>
          <button className="settings__save" onClick={refresh}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}

/** Read-only per-console firmware/BIOS deployment status. Unlike the staging
 *  list above, this shows whether each console's BIOS is actually deployed into
 *  its emulator (so e.g. PS2 games will boot in PCSX2), not just downloaded. */
function FirmwareStatusGroup({ firmware }: { firmware: FirmwareStatus[] }) {
  if (firmware.length === 0) return null;
  return (
    <>
      <h3 className="emu-group">Firmware deployment</h3>
      <p className="catalog__status">
        Whether each console’s BIOS is deployed into its emulator. Deployed firmware is staged into
        the emulator automatically on launch.
      </p>
      <ul className="emu-list">
        {firmware.map((fw) => {
          const state = fw.deployed ? "on" : fw.staged ? "mid" : "off";
          const badge = fw.deployed ? "Deployed ✓" : fw.staged ? "Staged" : "Missing";
          return (
            <li className="emu-row" key={`${fw.console}/${fw.emulator}`}>
              <span className={`emu-row__dot emu-row__dot--${state}`} aria-hidden />
              <span className="emu-row__name">
                {fw.console} <span className="emu-row__emu">({fw.emulator})</span>
              </span>
              <span className="emu-row__detail">{fw.detail}</span>
              <span className={`emu-row__fwbadge emu-row__fwbadge--${state}`}>{badge}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function EmulatorGroup({
  label,
  items,
  progress,
  onDownload,
}: {
  label: string;
  items: EmulatorStatus[];
  progress: Record<string, EmulatorProgress>;
  onDownload: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="emu-group">{label}</h3>
      <ul className="emu-list">
        {items.map((emu) => (
          <EmulatorRow key={emu.id} emu={emu} progress={progress[emu.id]} onDownload={onDownload} />
        ))}
      </ul>
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
