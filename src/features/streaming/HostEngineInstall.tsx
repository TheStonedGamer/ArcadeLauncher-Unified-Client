// Settings → "Stream from this PC": explicit status + download/update control for
// the streaming host engine components (the unbundled Sunshine host sidecar,
// fetched per engine release into `host-engine/<ver>/`). These normally download
// automatically the first time you enable hosting; this surface makes the state
// visible — installed? which version? — and lets the user install, update, or
// repair them on demand (the recovery path when a stale/partial sidecar is what's
// keeping this PC from hosting).

import { useCallback, useEffect, useState } from "react";
import { hostInstall, hostInstallStatus, type HostInstallStatus } from "./api";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function HostEngineInstall() {
  const [status, setStatus] = useState<HostInstallStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await hostInstallStatus());
      setError(null);
    } catch (e) {
      setStatus(null);
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // `force` is true when already installed: the button then re-downloads the same
  // version (reinstall / repair). When not installed it's a plain download — which
  // is also how an *update* lands, since a newer app build bumps the expected
  // version and flips the status to "not installed" for it.
  const run = useCallback(async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await hostInstall(force));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const installed = status?.installed ?? false;
  const version = status?.version ?? "";

  const statusLabel =
    status === null
      ? error
        ? "Status unavailable"
        : "Checking…"
      : installed
        ? `Installed — v${version}`
        : `Not installed${version ? ` — v${version} available` : ""}`;

  const actionLabel = busy
    ? "Working…"
    : installed
      ? `Reinstall v${version}`
      : version
        ? `Download v${version}`
        : "Download";

  return (
    <>
      <h3 className="emu-group">Host engine</h3>
      <p className="catalog__status">
        The streaming host components{version ? <> (Sunshine v{version})</> : null} that let this PC
        be streamed. They download automatically the first time you enable hosting — use this to
        install, update, or repair them manually.
      </p>
      <p className="catalog__status">
        <span className={`emu-row__dot emu-row__dot--${installed ? "on" : "off"}`} aria-hidden />{" "}
        <strong>{statusLabel}</strong>
        {installed && status?.path ? <span className="emu-row__emu"> · {status.path}</span> : null}
      </p>
      <div className="settings__actions">
        <button className="settings__save" onClick={() => void run(installed)} disabled={busy}>
          {actionLabel}
        </button>
        <button className="emu-row__btn" onClick={() => void refresh()} disabled={busy}>
          Refresh status
        </button>
        {error && <span className="settings__saved">Couldn’t update host engine: {error}</span>}
      </div>
    </>
  );
}
