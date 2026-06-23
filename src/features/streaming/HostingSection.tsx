// Settings → "Stream from this PC" (T12k-6): drive the engine's host mode so
// this machine can be streamed. Shows hosting status, a one-toggle enable, and a
// "publish my library" action that registers installed games as streamable apps.
//
// When the engine reports it can't host (or the call errors) this section
// degrades to a clear notice instead of pretending it works.

import { useState } from "react";
import { useHosting } from "./useHosting";
import { hostGamesFromLibrary, hostStatusSummary, storeGamesToHostGames } from "./streaming";
import { publishMyLibrary, type MyPcApp } from "./api";
import { loadCatalog } from "../catalog/api";
import { scanStore } from "../stores/api";
import { useSession } from "../session/SessionContext";

export function HostingSection() {
  const { status, error, busy, installing, setEnabled, sync } = useHosting();
  const { session } = useSession();
  const [msg, setMsg] = useState("");

  const publish = async () => {
    setMsg("Publishing your library…");
    try {
      // Publish both the ArcadeLauncher catalog and the auto-detected storefront games (Steam/Epic)
      // so installed store titles are streamable too. A storefront that isn't installed just scans
      // empty; a scan failure shouldn't sink the whole publish.
      const [catalog, steam, epic] = await Promise.all([
        loadCatalog(),
        scanStore("steam").catch(() => []),
        scanStore("epic").catch(() => []),
      ]);
      const games = [
        ...hostGamesFromLibrary(catalog),
        ...storeGamesToHostGames([...steam, ...epic]),
      ];
      if (games.length === 0) {
        setMsg("No installed games to publish.");
        return;
      }
      // Publish to the account registry so these games appear (and stay browsable
      // while this PC sleeps) under "My PCs" on your other devices. This is
      // independent of the engine host support below — discovery + library work
      // even before this PC is a fully streamable host. coverPath is a relative
      // catalog art ref, carried through as coverRef.
      if (session) {
        const apps: MyPcApp[] = games.map((g) => ({
          gameKey: g.id,
          name: g.name,
          coverRef: g.coverPath,
        }));
        await publishMyLibrary(session.host, session.token, apps);
      }
      // Best-effort: also register them with the engine's host mode for actual
      // streaming (a stub until that milestone lands → may report unavailable).
      const res = await sync(games);
      const count = `${games.length} game${games.length === 1 ? "" : "s"}`;
      setMsg(
        res
          ? `Published ${count} (+${res.added} / −${res.removed} / ~${res.updated}).`
          : `Published ${count} to your account. Streaming from this PC isn’t available yet.`,
      );
    } catch (e) {
      setMsg(`Couldn't publish: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // No status + an error = the engine couldn't answer (host mode unavailable).
  const unavailable = status === null;
  // We adopted a Sunshine the user already had running. We never started it, so we never stop it
  // (their choice) — the toggle is locked on and we just explain the situation.
  const adopted = status !== null && status.running && status.managed === false;

  return (
    <>
      <h3 className="emu-group">Stream from this PC</h3>
      <p className="catalog__status">
        Let other devices on your account stream the games installed here, like Steam Remote Play.
        The first time you turn this on, the host components download automatically — no separate
        Sunshine setup.
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
              // Not gated on status.installed: the first enable downloads the host
              // sidecar. GPU capability is still required. Locked on when we've
              // adopted a Sunshine the user runs themselves — we don't stop theirs.
              disabled={busy || installing || !status.gpuCapable || adopted}
              onChange={(e) => void setEnabled(e.target.checked, session)}
            />
            Let this PC be streamed
          </label>
          {adopted && (
            <p className="catalog__status">
              Using the Sunshine already running on this PC. Since you started it, the launcher
              leaves it running — stop it from Sunshine itself.
            </p>
          )}
          {installing && (
            <p className="catalog__status">Downloading host components…</p>
          )}
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
