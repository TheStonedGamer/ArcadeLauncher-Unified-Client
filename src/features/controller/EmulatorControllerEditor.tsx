// Per-emulator controller remap editor. Pick an emulator, rebind each host
// (Xbox-style) button to an SDL input token, tune the stick dead zone, then
// Save (persist the profile) and Apply (write the emulator's native pad config
// and place any staged BIOS). The host-button list, token options, and profiles
// all come from the Rust `controller` module; the pure binding logic lives in
// `profile.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  controllerApply,
  controllerHostButtons,
  controllerLoadProfiles,
  controllerSaveProfile,
  controllerSdlTokens,
  controllerTargets,
  type ApplyReport,
  type ControllerTarget,
  type HostButton,
  type Profile,
} from "./api";
import {
  clampDeadZone,
  emptyProfile,
  profilesEqual,
  resetProfile,
  setBinding,
  tokenFor,
} from "./profile";

export function EmulatorControllerEditor() {
  const [buttons, setButtons] = useState<HostButton[]>([]);
  const [tokens, setTokens] = useState<string[]>([]);
  const [targets, setTargets] = useState<ControllerTarget[]>([]);
  const [emulatorId, setEmulatorId] = useState<string>("");
  // The profile as last saved (baseline for the dirty check) and the live draft.
  const [saved, setSaved] = useState<Profile>(emptyProfile());
  const [draft, setDraft] = useState<Profile>(emptyProfile());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the static metadata (buttons, tokens, targets) once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, t, tg] = await Promise.all([
          controllerHostButtons(),
          controllerSdlTokens(),
          controllerTargets(),
        ]);
        if (cancelled) return;
        setButtons(b);
        setTokens(t);
        setTargets(tg);
        if (tg.length > 0) setEmulatorId(tg[0].id);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // (Re)load the selected emulator's saved profile whenever it changes.
  useEffect(() => {
    if (!emulatorId) return;
    let cancelled = false;
    setStatus(null);
    setError(null);
    (async () => {
      try {
        const all = await controllerLoadProfiles();
        if (cancelled) return;
        const p = all.profiles[emulatorId] ?? emptyProfile();
        setSaved(p);
        setDraft(p);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [emulatorId]);

  const target = useMemo(
    () => targets.find((t) => t.id === emulatorId),
    [targets, emulatorId],
  );
  const dirty = useMemo(
    () => buttons.length > 0 && !profilesEqual(draft, saved, buttons),
    [draft, saved, buttons],
  );

  const onRebind = useCallback(
    (hostId: string, token: string) =>
      setDraft((d) => setBinding(d, buttons, hostId, token)),
    [buttons],
  );

  const onDeadZone = useCallback(
    (pct: number) => setDraft((d) => ({ ...d, deadZone: clampDeadZone(pct / 100) })),
    [],
  );

  const onReset = useCallback(() => setDraft(resetProfile()), []);

  const onSave = useCallback(async () => {
    if (!emulatorId) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const all = await controllerSaveProfile(emulatorId, draft);
      const p = all.profiles[emulatorId] ?? emptyProfile();
      setSaved(p);
      setDraft(p);
      setStatus("Saved ✓");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [emulatorId, draft]);

  const onApply = useCallback(async () => {
    if (!emulatorId) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      // Persist first so apply reads exactly what's on screen.
      if (dirty) {
        const all = await controllerSaveProfile(emulatorId, draft);
        const p = all.profiles[emulatorId] ?? emptyProfile();
        setSaved(p);
        setDraft(p);
      }
      const report: ApplyReport = await controllerApply(emulatorId);
      setStatus(formatReport(report));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [emulatorId, draft, dirty]);

  if (loading) return <p className="catalog__status">Loading controller config…</p>;

  return (
    <section className="cc-editor">
      <h2 className="settings__heading">Emulator controller mapping</h2>
      <p className="catalog__status">
        Rebind your gamepad per emulator. Buttons use SDL input names (the same ones PCSX2 and
        DuckStation expect). Save stores the profile; Apply writes it into the emulator’s config.
      </p>

      {targets.length === 0 ? (
        <p className="catalog__status">No remappable emulators are available.</p>
      ) : (
        <>
          <label className="settings__field">
            <span className="settings__label">Emulator</span>
            <select
              className="settings__input"
              value={emulatorId}
              onChange={(e) => setEmulatorId(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.installed ? "" : " — not installed"}
                </option>
              ))}
            </select>
          </label>

          {target && !target.installed && (
            <p className="catalog__status">
              This emulator isn’t installed yet — you can edit and save its profile now, but Apply
              will only write the config once the runtime is downloaded.
            </p>
          )}

          <div className="cc-grid">
            {buttons.map((b) => {
              const value = tokenFor(draft, buttons, b.id);
              const remapped = value !== b.defaultToken;
              return (
                <div key={b.id} className="cc-grid__row">
                  <span className="cc-grid__label">{b.label}</span>
                  <select
                    className={`settings__input cc-grid__select${remapped ? " cc-grid__select--remapped" : ""}`}
                    value={value}
                    onChange={(e) => onRebind(b.id, e.target.value)}
                  >
                    {tokens.map((tok) => (
                      <option key={tok} value={tok}>
                        {tok}
                        {tok === b.defaultToken ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <label className="settings__field">
            <span className="settings__label">
              Stick dead zone: {Math.round(draft.deadZone * 100)}%
            </span>
            <input
              className="settings__input settings__input--range"
              type="range"
              min={5}
              max={95}
              step={5}
              value={Math.round(draft.deadZone * 100)}
              onChange={(e) => onDeadZone(Number(e.target.value))}
            />
          </label>

          <div className="settings__actions">
            <button className="settings__save" onClick={onSave} disabled={busy || !dirty}>
              Save
            </button>
            <button className="settings__save" onClick={onApply} disabled={busy}>
              Apply to emulator
            </button>
            <button className="emu-row__btn" onClick={onReset} disabled={busy}>
              Reset to default
            </button>
            {dirty && <span className="catalog__status">Unsaved changes</span>}
            {status && <span className="settings__saved">{status}</span>}
            {error && <span className="catalog__error">{error}</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** A short human summary of an apply result for the status line. */
function formatReport(report: ApplyReport): string {
  if (!report.applied) return report.note ?? "Nothing to apply.";
  const parts = ["Applied ✓"];
  if (report.backupPath) parts.push("(previous config backed up)");
  const placed = report.biosMessages.filter((m) => m.includes("placed"));
  if (placed.length > 0) parts.push(`BIOS: ${placed.length} placed`);
  return parts.join(" ");
}
