// Detail-panel affordance (T12k-4): stream this game from a paired Sunshine host.
// Shown only when at least one host is paired. Picks a host (auto when there's
// just one) and streams the host app whose name matches the game title, using the
// configured quality defaults. Playback runs through the bundled stream engine
// (live state + an in-app Stop).

import { useState } from "react";
import { streamPhaseLabel } from "./streaming";
import { useStreaming } from "./useStreaming";

export function StreamFromHost({ title }: { title: string }) {
  const { hosts, engine, streamState, play, stop } = useStreaming();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState("");

  // No hosts → nothing to stream from; keep the panel uncluttered.
  if (hosts.length === 0) return null;

  // Blocked only when the engine is known-absent. (engine starts as null =
  // unknown, so we don't disable then.)
  const noPath = engine === false;
  const streaming = streamState !== null;

  const start = async (address: string) => {
    setPicking(false);
    setMsg("Starting stream…");
    try {
      await play(address, title);
      // Engine streams report live state below, so no static message here.
      setMsg("");
    } catch (e) {
      setMsg(`Couldn't start stream: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onClick = () => {
    if (hosts.length === 1) {
      void start(hosts[0].address);
    } else {
      setPicking((v) => !v);
    }
  };

  const onStop = async () => {
    await stop();
    setMsg("");
  };

  // While an engine stream is live, the affordance becomes the live status + Stop.
  if (streaming) {
    return (
      <div className="detail__stream">
        <button className="detail__fetch" onClick={onStop}>
          ■ Stop stream
        </button>
        <span className="detail__fetchmsg">{streamPhaseLabel(streamState)}</span>
      </div>
    );
  }

  return (
    <div className="detail__stream">
      <button
        className="detail__fetch"
        onClick={onClick}
        disabled={noPath}
        title={noPath ? "The stream engine isn't available on this PC — reinstall to stream" : ""}
      >
        ▶ Stream from host
      </button>
      {picking && (
        <div className="detail__variant-list">
          {hosts.map((h) => (
            <button
              key={h.address}
              className="detail__variant"
              onClick={() => start(h.address)}
            >
              {h.name} ({h.address})
            </button>
          ))}
        </div>
      )}
      {noPath && (
        <span className="detail__fetchmsg">The stream engine isn’t available on this PC.</span>
      )}
      {msg && <span className="detail__fetchmsg">{msg}</span>}
    </div>
  );
}
