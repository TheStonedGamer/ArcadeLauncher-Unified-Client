// GIF picker popover for the composer. Searches Tenor with the user's own API
// key (Settings → Integrations) and sends the chosen GIF as a plain-text URL —
// see gifs.ts for why that shape was chosen.

import { useEffect, useRef, useState } from "react";
import {
  GIF_LIMIT,
  parseGifs,
  searchUrl,
  trendingUrl,
  type Gif,
} from "../gifs";
import { loadSettings } from "../../settings/api";

interface Props {
  onPick: (url: string) => void;
  onClose: () => void;
}

export function GifPicker({ onPick, onClose }: Props) {
  const [key, setKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!box.current?.contains(ev.target as Node)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((s) => alive && setKey((s.tenorApiKey ?? "").trim()))
      .catch(() => alive && setKey(""));
    return () => {
      alive = false;
    };
  }, []);

  // Debounced so typing a word isn't a request per keystroke against a quota
  // the user is paying for with their own key.
  useEffect(() => {
    if (key === null) return;
    if (key === "") {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const q = query.trim();
    const timer = setTimeout(() => {
      fetch(
        q === "" ? trendingUrl(key, GIF_LIMIT) : searchUrl(key, q, GIF_LIMIT),
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(`Tenor returned ${r.status}`);
          return r.json();
        })
        .then((body) => {
          if (!alive) return;
          setGifs(parseGifs(body));
          setError("");
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setGifs([]);
          setError(err instanceof Error ? err.message : "GIF search failed");
        })
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, query]);

  return (
    <div
      className="picker picker--gif"
      ref={box}
      role="dialog"
      aria-label="GIFs"
    >
      <input
        className="picker__search"
        autoFocus
        value={query}
        placeholder="Search Tenor"
        disabled={key === ""}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="picker__body">
        {key === "" ? (
          <p className="picker__empty">
            Add a Tenor API key in Settings → Integrations to search for GIFs.
          </p>
        ) : loading ? (
          <p className="picker__empty">Loading…</p>
        ) : error !== "" ? (
          <p className="picker__empty">{error}</p>
        ) : gifs.length === 0 ? (
          <p className="picker__empty">No GIFs found.</p>
        ) : (
          <div className="picker__gifs">
            {gifs.map((g) => (
              <button
                key={g.id}
                type="button"
                className="picker__gif"
                title={g.description}
                onClick={() => onPick(g.url)}
              >
                <img
                  src={g.previewUrl}
                  alt={g.description || "GIF"}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
