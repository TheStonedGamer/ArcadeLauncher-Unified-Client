// "My PCs" tab (T12k-7 + T12k-9): every PC signed into your ArcadeLauncher
// account appears here automatically — no IP typing. Each PC publishes its game
// library, so an offline PC stays listed (greyed) with its last-known games still
// browsable; an online PC with a reachable address offers Play per game.
//
// The device list + discovery come from useMyPcs (account-brokered, push-refreshed
// by the server's stream_host_update). A PC's library is fetched on expand
// (pcApps). Play rides the existing useStreaming().play(address, app) path,
// preferring a LAN address and, when there is none, joining the Headscale overlay
// (T12k-8 play-from-anywhere) to dial the PC's mesh IP. The mesh path is only
// offered when the bundled Tailscale is present (meshIsAvailable). Manual
// pair-by-IP remains available under Settings → Streaming as a fallback.

import { useCallback, useEffect, useState } from "react";
import { useStreaming } from "./useStreaming";
import { useMyPcs } from "./useMyPcs";
import { isNotPairedError, isValidPin } from "./streaming";
import {
  meshIsAvailable,
  meshJoin,
  meshPreauth,
  meshResolveHost,
  myPcsSelf,
  pcApps,
  type MyPc,
  type MyPcApp,
} from "./api";
import { pinHostBeforePlay } from "./certAuth";
import { useSession } from "../session/SessionContext";
import type { Session } from "../session/types";

/** The LAN address to dial for a PC, or "" when it advertises none. The mesh path
 *  (joining the overlay + resolving the PC's 100.64.x.x IP at Play time) is taken
 *  only when there is no LAN address, so it isn't reflected here. */
function streamAddress(pc: MyPc): string {
  return pc.lanAddr || "";
}

/** Join the overlay (server-minted single-use pre-auth key → bundled tailscaled)
 *  and resolve `pc`'s current mesh IP by its node hostname. Throws a user-facing
 *  message when the PC isn't reachable on the mesh. The client joins as an
 *  ephemeral node so Headscale reaps it after the session. */
async function resolveMeshAddress(session: Session, pc: MyPc): Promise<string> {
  const me = await myPcsSelf();
  const pre = await meshPreauth(session.host, session.token, me.name, true);
  await meshJoin(pre.key, me.name, true);
  const ip = await meshResolveHost(pc.name);
  if (!ip) throw new Error(`${pc.name} isn’t reachable over the internet right now`);
  return ip;
}

/** One PC row: an online/offline dot, name + status, and (on expand) its
 *  published library. Offline PCs are greyed but still expandable; Play is
 *  offered when the PC is online and is reachable — either on the LAN or, when
 *  the bundled mesh is available, over the internet via Headscale. */
function PcCard({
  pc,
  canStream,
  meshReady,
  onPlay,
}: {
  pc: MyPc;
  canStream: boolean;
  meshReady: boolean;
  onPlay: (pc: MyPc, app: string) => Promise<void>;
}) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<MyPcApp[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState("");

  const lanAddr = streamAddress(pc);
  // Reachable if it has a LAN address, or the bundled mesh can dial it remotely.
  const reachable = lanAddr !== "" || meshReady;
  const playable = pc.online && reachable && canStream;

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
      await onPlay(pc, app);
    } finally {
      setPlaying("");
    }
  };

  const playTitle = !pc.online
    ? "This PC is offline"
    : !reachable
      ? "This PC has no reachable address"
      : !canStream
        ? "Install Moonlight or the stream engine to play"
        : "";

  // Address column: the LAN IP, or note that play will go over the mesh.
  const addrLabel = lanAddr || (meshReady ? "over the internet" : "no address");

  return (
    <li className={`mypcs__card${pc.online ? "" : " mypcs__card--offline"}`}>
      <button className="mypcs__cardhead" onClick={toggle} aria-expanded={open}>
        <span className={`emu-row__dot emu-row__dot--${pc.online ? "on" : "off"}`} aria-hidden />
        <span className="mypcs__name">{pc.name}</span>
        <span className="mypcs__addr">{addrLabel}</span>
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
  const { session } = useSession();
  const { moonlight, engine, play, pair } = useStreaming();
  const { pcs, loading, error } = useMyPcs();
  const [banner, setBanner] = useState("");
  // Whether the bundled Tailscale is present (gate 2). False keeps the mesh path
  // inert — LAN-less PCs simply aren't playable rather than offering a dead Play.
  const [meshReady, setMeshReady] = useState(false);
  // Set when a Play was rejected `not_paired`: the PC needs a one-time GameStream
  // pairing first. We capture the resolved address so the inline PIN prompt pairs
  // against the same host the stream would use, then auto-retries Play. (UX guard
  // until brokered zero-PIN auto-pairing lands — see uc_my_pcs_account_discovery.)
  const [pairPrompt, setPairPrompt] = useState<{ pc: MyPc; app: string; address: string } | null>(
    null,
  );
  const [pin, setPin] = useState("");
  const [pairing, setPairing] = useState(false);

  // Play is possible via the bundled engine OR an external Moonlight install.
  const canStream = engine === true || moonlight === true;

  useEffect(() => {
    meshIsAvailable()
      .then(setMeshReady)
      .catch(() => setMeshReady(false));
  }, []);

  const onPlay = useCallback(
    async (pc: MyPc, app: string) => {
      setBanner("");
      setPairPrompt(null);
      // Resolve outside the try so the catch can offer to pair the same address.
      let address = streamAddress(pc);
      try {
        // Prefer the LAN address; otherwise join the overlay and dial the mesh IP.
        if (address === "") {
          if (!session) throw new Error("sign in to stream over the internet");
          setBanner(`Connecting to ${pc.name} over the internet…`);
          address = await resolveMeshAddress(session, pc);
        }
        // Zero-PIN auto-pair: pin this host's published server cert before streaming so the
        // GameStream handshake doesn't fail `not_paired`. No-op (and harmless) if the host hasn't
        // published a cert yet — Play then falls through to the inline PIN prompt below (fix B).
        await pinHostBeforePlay(address, pc);
        const via = await play(address, app);
        setBanner(`Streaming ${app}${via === "moonlight" ? " in Moonlight" : ""} ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A `not_paired` rejection isn't a failure to report — it means this PC
        // has never been paired. Offer the one-time PIN pairing inline instead of
        // a dead Play that just flashed a window.
        if (isNotPairedError(msg) && address !== "") {
          setBanner("");
          setPin("");
          setPairPrompt({ pc, app, address });
        } else {
          setBanner(`Couldn’t start stream: ${msg}`);
        }
      }
    },
    [play, session],
  );

  // Pair the not-yet-paired PC with the entered PIN, then auto-retry Play. The
  // user must type the same PIN into that PC's Sunshine (its tray → PIN) — the
  // GameStream handshake needs both sides to agree on the PIN.
  const submitPair = useCallback(async () => {
    if (!pairPrompt || !isValidPin(pin)) return;
    const { pc, app, address } = pairPrompt;
    setPairing(true);
    try {
      const ok = await pair(address, pin, pc.name);
      if (!ok) {
        setBanner("Pairing failed — check the PIN on both PCs and try again.");
        return;
      }
      setPairPrompt(null);
      setPin("");
      const via = await play(address, app);
      setBanner(`Streaming ${app}${via === "moonlight" ? " in Moonlight" : ""} ✓`);
    } catch (e) {
      setBanner(`Pairing failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPairing(false);
    }
  }, [pairPrompt, pin, pair, play]);

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

      {pairPrompt && (
        <div className="mypcs__pair">
          <p className="catalog__status">
            <strong>{pairPrompt.pc.name}</strong> needs a one-time pairing before you can stream
            from it. Enter a 4-digit PIN below, then go to that PC and type the <em>same</em> PIN
            into Sunshine (its tray icon → <strong>PIN</strong>, or{" "}
            <code>https://localhost:47990</code> → <strong>PIN</strong>).
          </p>
          <div className="mypcs__pairrow">
            <input
              className="settings__input"
              inputMode="numeric"
              maxLength={4}
              placeholder="4-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPair();
              }}
              disabled={pairing}
            />
            <button
              className="emu-row__btn"
              onClick={() => void submitPair()}
              disabled={!isValidPin(pin) || pairing}
            >
              {pairing ? "Pairing…" : "Pair & Play"}
            </button>
            <button
              className="emu-row__btn"
              onClick={() => {
                setPairPrompt(null);
                setPin("");
              }}
              disabled={pairing}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pcs.length === 0 ? (
        <p className="catalog__status">
          {loading
            ? "Looking for your other PCs…"
            : "No other PCs signed into your account yet. Sign in on another machine and it’ll appear here."}
        </p>
      ) : (
        <ul className="mypcs__list">
          {pcs.map((pc) => (
            <PcCard
              key={pc.deviceId}
              pc={pc}
              canStream={canStream}
              meshReady={meshReady}
              onPlay={onPlay}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
