// "My PCs" tab (T12k-7 + T12k-9): every PC signed into your ArcadeLauncher
// account appears here automatically — no IP typing. Each PC publishes its game
// library, so an offline PC stays listed (greyed) with its last-known games still
// browsable; an online PC with a reachable address offers Play per game.
//
// The device list + discovery come from useMyPcs (account-brokered, push-refreshed
// by the server's stream_host_update). A PC's library is fetched on expand
// (pcApps). Play rides the existing useStreaming().play(address, app) path,
// preferring LAN and falling back to the mesh address. Manual pair-by-IP remains
// available under Settings → Streaming as a fallback.

import { useCallback, useState } from "react";
import { useStreaming } from "./useStreaming";
import { useMyPcs } from "./useMyPcs";
import { pcApps, type MyPc, type MyPcApp } from "./api";
import { useSession } from "../session/SessionContext";

/** The address to dial for a PC: prefer LAN, fall back to the mesh address.
 *  Empty when the PC advertises no usable path. */
function streamAddress(pc: MyPc): string {
  return pc.lanAddr || pc.meshAddr || "";
}

/** One PC row: an online/offline dot, name + status, and (on expand) its
 *  published library. Offline PCs are greyed but still expandable; Play is
 *  offered only when the PC is online and has a reachable address. */
function PcCard({
  pc,
  canStream,
  onPlay,
}: {
  pc: MyPc;
  canStream: boolean;
  onPlay: (address: string, app: string) => Promise<void>;
}) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<MyPcApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState("");

  const address = streamAddress(pc);
  const playable = pc.online && address !== "" && canStream;

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setErr("");
    try {
      setApps(await pcApps(session.host, session.token, pc.deviceId));
    } catch (e) {
      setApps([]);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session, pc.deviceId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && apps === null && !loading) void load();
  };

  const play = async (app: string) => {
    setPlaying(app);
    try {
      await onPlay(address, app);
    } finally {
      setPlaying("");
    }
  };

  const playTitle = !pc.online
    ? "This PC is offline"
    : address === ""
      ? "This PC has no reachable address"
      : !canStream
        ? "Install Moonlight or the stream engine to play"
        : "";

  return (
    <li className={`mypcs__card${pc.online ? "" : " mypcs__card--offline"}`}>
      <button className="mypcs__cardhead" onClick={toggle} aria-expanded={open}>
        <span className={`emu-row__dot emu-row__dot--${pc.online ? "on" : "off"}`} aria-hidden />
        <span className="mypcs__name">{pc.name}</span>
        <span className="mypcs__addr">{address || "no address"}</span>
        <span className="mypcs__state">{pc.online ? "Online" : "Offline"}</span>
        <span className="mypcs__chevron" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mypcs__apps">
          {loading && <p className="catalog__status">Loading games…</p>}
          {!loading && err && (
            <p className="catalog__status">Couldn’t list this PC’s games — {err}.</p>
          )}
          {!loading && !err && apps && apps.length === 0 && (
            <p className="catalog__status">
              No games published from this PC yet. Turn on hosting under{" "}
              <strong>Settings → Stream from this PC</strong> on that machine.
            </p>
          )}
          {!loading && apps && apps.length > 0 && (
            <ul className="emu-list">
              {apps.map((a) => (
                <li className="emu-row" key={a.gameKey}>
                  <span className="emu-row__name">{a.name}</span>
                  <button
                    className="emu-row__btn"
                    onClick={() => void play(a.name)}
                    disabled={!playable || playing !== ""}
                    title={playTitle}
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
  const { moonlight, engine, play } = useStreaming();
  const { pcs, loading, error } = useMyPcs();
  const [banner, setBanner] = useState("");

  // Play is possible via the bundled engine OR an external Moonlight install.
  const canStream = engine === true || moonlight === true;

  const onPlay = useCallback(
    async (address: string, app: string) => {
      setBanner("");
      try {
        const via = await play(address, app);
        setBanner(`Streaming ${app}${via === "moonlight" ? " in Moonlight" : ""} ✓`);
      } catch (e) {
        setBanner(`Couldn’t start stream: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [play],
  );

  return (
    <section className="mypcs">
      <h2 className="settings__heading">My PCs</h2>
      <p className="catalog__status">
        Every PC signed into your account shows up here automatically — no IP to type. Offline PCs
        stay listed so you can still browse their games. Turn a PC into a host under{" "}
        <strong>Settings → Stream from this PC</strong>.
      </p>
      {engine !== true && moonlight === false && (
        <p className="catalog__status">
          Neither the stream engine nor Moonlight is available on this PC — install one to play
          remote games.
        </p>
      )}
      {error && <p className="catalog__status">Couldn’t load your PCs — {error}.</p>}
      {banner && <p className="catalog__status">{banner}</p>}

      {pcs.length === 0 ? (
        <p className="catalog__status">
          {loading
            ? "Looking for your other PCs…"
            : "No other PCs signed into your account yet. Sign in on another machine and it’ll appear here."}
        </p>
      ) : (
        <ul className="mypcs__list">
          {pcs.map((pc) => (
            <PcCard key={pc.deviceId} pc={pc} canStream={canStream} onPlay={onPlay} />
          ))}
        </ul>
      )}
    </section>
  );
}
