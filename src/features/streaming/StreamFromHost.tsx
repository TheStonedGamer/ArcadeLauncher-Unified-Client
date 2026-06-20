// Detail-panel affordance (T12k-4): stream this game from a paired Sunshine host
// via Moonlight. Shown only when at least one host is paired. Picks a host (auto
// when there's just one) and launches Moonlight with the configured quality
// defaults, streaming the host app whose name matches the game title.

import { useState } from "react";
import { useStreaming } from "./useStreaming";

export function StreamFromHost({ title }: { title: string }) {
  const { hosts, moonlight, launch } = useStreaming();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState("");

  // No hosts → nothing to stream from; keep the panel uncluttered.
  if (hosts.length === 0) return null;

  const start = async (address: string) => {
    setPicking(false);
    setMsg("Starting stream…");
    try {
      await launch(address, title);
      setMsg("Stream launched in Moonlight ✓");
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

  return (
    <div className="detail__stream">
      <button
        className="detail__fetch"
        onClick={onClick}
        disabled={moonlight === false}
        title={moonlight === false ? "Install the Moonlight client to stream" : ""}
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
      {moonlight === false && (
        <span className="detail__fetchmsg">Moonlight isn’t installed on this PC.</span>
      )}
      {msg && <span className="detail__fetchmsg">{msg}</span>}
    </div>
  );
}
