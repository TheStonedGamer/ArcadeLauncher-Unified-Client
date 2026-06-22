// "My PCs" tab (T12k-9, client MVP): your paired streaming hosts and the games
// each exposes, with a Play button per game. Discovery of a host's apps goes
// through the engine (`client.apps`); Play still launches via the external
// Moonlight client (option a — kept until the engine streams). The cross-device
// server-published library + offline greying (the full T12k-9) layer on later.

import { useCallback, useState } from "react";
import { useStreaming } from "./useStreaming";
import { engineApps, type EngineApp, type StreamHost } from "./api";
import { hostStateLabel } from "./streaming";

/** One host row: lazily loads its apps from the engine on expand, then offers a
 *  Play button per game (Moonlight launch with the configured quality). */
function HostCard({
  host,
  moonlight,
  onPlay,
}: {
  host: StreamHost;
  moonlight: boolean | null;
  onPlay: (address: string, app: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<EngineApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await engineApps(host.address);
      setApps(res.apps);
    } catch (e) {
      setApps([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [host.address]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && apps === null && !loading) void load();
  };

  const play = async (app: string) => {
    setPlaying(app);
    try {
      await onPlay(host.address, app);
    } finally {
      setPlaying("");
    }
  };

  return (
    <li className="mypcs__card">
      <button className="mypcs__cardhead" onClick={toggle} aria-expanded={open}>
        <span className={`emu-row__dot emu-row__dot--${host.state === "online" ? "on" : "off"}`} aria-hidden />
        <span className="mypcs__name">{host.name}</span>
        <span className="mypcs__addr">{host.address}</span>
        <span className="mypcs__state">{hostStateLabel(host.state)}</span>
        <span className="mypcs__chevron" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mypcs__apps">
          {loading && <p className="catalog__status">Loading games…</p>}
          {!loading && err && (
            <p className="catalog__status">
              Couldn’t list this PC’s games — {err}. The host may be offline or its game library
              hasn’t been published yet.
            </p>
          )}
          {!loading && !err && apps && apps.length === 0 && (
            <p className="catalog__status">No games published on this PC yet.</p>
          )}
          {!loading && apps && apps.length > 0 && (
            <ul className="emu-list">
              {apps.map((a) => (
                <li className="emu-row" key={a.name}>
                  <span className="emu-row__name">{a.name}</span>
                  <button
                    className="emu-row__btn"
                    onClick={() => void play(a.name)}
                    disabled={moonlight === false || playing !== ""}
                    title={moonlight === false ? "Install the Moonlight client to stream" : ""}
                  >
                    {playing === a.name ? "Starting…" : "▶ Play"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function MyPcsView() {
  const { hosts, moonlight, launch } = useStreaming();
  const [banner, setBanner] = useState("");

  const onPlay = useCallback(
    async (address: string, app: string) => {
      setBanner("");
      try {
        await launch(address, app);
        setBanner(`Streaming ${app} in Moonlight ✓`);
      } catch (e) {
        setBanner(`Couldn’t start stream: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [launch],
  );

  return (
    <section className="mypcs">
      <h2 className="settings__heading">My PCs</h2>
      <p className="catalog__status">
        Stream games installed on your other machines to this one. Pair a PC under{" "}
        <strong>Settings → Streaming</strong>; turn a PC into a host under{" "}
        <strong>Settings → Stream from this PC</strong>.
      </p>
      {moonlight === false && (
        <p className="catalog__status">
          Moonlight isn’t installed on this PC — install it to play remote games.
        </p>
      )}
      {banner && <p className="catalog__status">{banner}</p>}

      {hosts.length === 0 ? (
        <p className="catalog__status">
          No PCs paired yet. Pair one in <strong>Settings → Streaming</strong> to see it here.
        </p>
      ) : (
        <ul className="mypcs__list">
          {hosts.map((h) => (
            <HostCard key={h.address} host={h} moonlight={moonlight} onPlay={onPlay} />
          ))}
        </ul>
      )}
    </section>
  );
}
