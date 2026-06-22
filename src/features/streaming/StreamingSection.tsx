// Settings → Streaming (T12k-4): pair with / forget streaming hosts and set the
// stream-quality defaults passed through to Moonlight. Pairing runs through the
// stream engine (4-digit GameStream PIN — no host web credentials); the host +
// its pinned cert live on disk (Rust), and the quality defaults persist locally
// (localStorage).

import { useState } from "react";
import { useStreaming } from "./useStreaming";
import { DISPLAY_MODES, hostStateLabel, isValidPin, type DisplayMode } from "./streaming";

export function StreamingSection() {
  const { hosts, moonlight, settings, setDefaults, pair, forget } = useStreaming();
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const canPair = address.trim() !== "" && isValidPin(pin) && !busy;

  const doPair = async () => {
    setBusy(true);
    setMsg("");
    try {
      const ok = await pair(address.trim(), pin, "ArcadeLauncher");
      setMsg(ok ? "Paired ✓" : "The host rejected the PIN — check it and try again.");
      if (ok) setPin("");
    } catch (e) {
      setMsg(`Couldn't pair: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doForget = async (addr: string) => {
    try {
      await forget(addr);
    } catch {
      /* ignore — refresh reflects reality */
    }
  };

  return (
    <>
      <h2 className="settings__heading">Streaming</h2>
      <p className="catalog__status">
        Stream an installed game from a host PC running <strong>Sunshine</strong> to this machine
        with <strong>Moonlight</strong>. Pair with a host once using its 4-digit PIN; the host’s
        certificate is pinned on first pair so the connection stays secure. No host username or
        password is needed.
      </p>

      <p className="catalog__status">
        Moonlight client:{" "}
        <strong>
          {moonlight === null ? "checking…" : moonlight ? "installed ✓" : "not found on PATH"}
        </strong>
        {moonlight === false && " — install Moonlight to start streams from the library."}
      </p>

      <h3 className="emu-group">Paired hosts</h3>
      {hosts.length === 0 ? (
        <p className="catalog__status">No hosts paired yet.</p>
      ) : (
        <ul className="emu-list">
          {hosts.map((h) => (
            <li className="emu-row" key={h.address}>
              <span className={`emu-row__dot emu-row__dot--${h.state === "online" ? "on" : "off"}`} aria-hidden />
              <span className="emu-row__name">
                {h.name} <span className="emu-row__emu">({h.address})</span>
              </span>
              <span className="emu-row__detail">{hostStateLabel(h.state)}</span>
              <button className="emu-row__btn" onClick={() => doForget(h.address)}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="emu-group">Pair a host</h3>
      <label className="settings__field">
        <span className="settings__label">Host address (IP or hostname)</span>
        <input
          className="settings__input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 10.0.0.50"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="settings__field">
        <span className="settings__label">PIN (4 digits)</span>
        <input
          className="settings__input settings__input--num"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          placeholder="1234"
        />
      </label>
      <div className="settings__actions">
        <button className="settings__save" onClick={doPair} disabled={!canPair}>
          {busy ? "Pairing…" : "Pair host"}
        </button>
        {msg && <span className="settings__saved">{msg}</span>}
      </div>

      <h3 className="emu-group">Stream quality defaults</h3>
      <p className="catalog__status">Applied to every stream you start from the library.</p>
      <label className="settings__field">
        <span className="settings__label">Resolution width × height</span>
        <span className="detail__collection-add">
          <input
            className="settings__input settings__input--num"
            type="number"
            min={640}
            max={7680}
            value={settings.width}
            onChange={(e) => setDefaults({ ...settings, width: Number(e.target.value) || 0 })}
          />
          <input
            className="settings__input settings__input--num"
            type="number"
            min={480}
            max={4320}
            value={settings.height}
            onChange={(e) => setDefaults({ ...settings, height: Number(e.target.value) || 0 })}
          />
        </span>
      </label>
      <label className="settings__field">
        <span className="settings__label">Frame rate (fps)</span>
        <input
          className="settings__input settings__input--num"
          type="number"
          min={30}
          max={240}
          value={settings.fps}
          onChange={(e) => setDefaults({ ...settings, fps: Number(e.target.value) || 0 })}
        />
      </label>
      <label className="settings__field">
        <span className="settings__label">Bitrate (Kbps)</span>
        <input
          className="settings__input settings__input--num"
          type="number"
          min={500}
          max={150000}
          step={500}
          value={settings.bitrateKbps}
          onChange={(e) => setDefaults({ ...settings, bitrateKbps: Number(e.target.value) || 0 })}
        />
      </label>
      <label className="settings__field">
        <span className="settings__label">Window mode</span>
        <select
          className="settings__input"
          value={settings.displayMode}
          onChange={(e) => setDefaults({ ...settings, displayMode: e.target.value as DisplayMode })}
        >
          {DISPLAY_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={settings.hdr}
          onChange={(e) => setDefaults({ ...settings, hdr: e.target.checked })}
        />
        Stream in HDR (host + display must support it)
      </label>
    </>
  );
}
