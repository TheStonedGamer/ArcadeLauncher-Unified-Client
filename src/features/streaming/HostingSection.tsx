// Settings → "Stream from this PC" (T12k-6): drive the engine's host mode so
// this machine can be streamed. Shows hosting status, a one-toggle enable, and a
// "publish my library" action that registers installed games as streamable apps.
//
// The engine's host.* handlers are stubs until that milestone lands, so when the
// engine reports it can't host (or the call errors) this section degrades to a
// clear notice instead of pretending it works.

import { useState } from "react";
import { useHosting } from "./useHosting";
import { hostGamesFromLibrary, hostStatusSummary } from "./streaming";
import { loadCatalog } from "../catalog/api";

export function HostingSection() {
  const { status, error, busy, setEnabled, sync } = useHosting();
  const [msg, setMsg] = useState("");

  const publish = async () => {
    setMsg("Publishing your library…");
    try {
      const games = hostGamesFromLibrary(await loadCatalog());
      if (games.length === 0) {
        setMsg("No installed games to publish.");
        return;
      }
      const res = await sync(games);
      setMsg(
        res
          ? `Published ${games.length} game${games.length === 1 ? "" : "s"} (+${res.added} / −${res.removed} / ~${res.updated}).`
          : "Couldn't publish — hosting isn't available on this PC yet.",
      );
    } catch (e) {
      setMsg(`Couldn't publish: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // No status + an error = the engine couldn't answer (host mode unavailable).
  const unavailable = status === null;

  return (
    <>
      <h3 className="emu-group">Stream from this PC</h3>
      <p className="catalog__status">
        Let other devices on your account stream the games installed here, like Steam Remote Play.
        Hosting runs in the bundled streaming engine — no separate Sunshine setup.
      </p>

      {unavailable ? (
        <p className="catalog__status">
          Hosting isn’t available on this PC yet
          {error ? <> — {error}</> : null}. This needs the streaming engine’s host support, which is
          still rolling out.
        </p>
      ) : (
        <>
          <p className="catalog__status">
            <strong>{hostStatusSummary(status)}</strong>
          </p>
          <label className="settings__check">
            <input
              type="checkbox"
              checked={status.running}
              disabled={busy || !status.installed || !status.gpuCapable}
              onChange={(e) => void setEnabled(e.target.checked)}
            />
            Let this PC be streamed
          </label>
          <div className="settings__actions">
            <button className="settings__save" onClick={() => void publish()} disabled={busy}>
              {busy ? "Working…" : "Publish my library"}
            </button>
            {msg && <span className="settings__saved">{msg}</span>}
          </div>
        </>
      )}
    </>
  );
}
