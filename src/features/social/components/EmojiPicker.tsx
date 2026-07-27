// Emoji picker popover for the composer. Offline — the set is bundled (see
// emoji.ts) — with search, category tabs, and a recents row persisted locally
// so the emoji you actually use are one click away.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  parseRecent,
  pushRecent,
  searchEmoji,
  type Emoji,
} from "../emoji";

const RECENT_KEY = "social.emoji.recent";

function loadRecent(): string[] {
  try {
    return parseRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

interface Props {
  onPick: (glyph: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(EMOJI_GROUPS[0].name);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const box = useRef<HTMLDivElement>(null);

  // Click-away and Escape both close, like every other popover in the client.
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

  const searching = query.trim() !== "";
  const shown: Emoji[] = useMemo(() => {
    if (searching) return searchEmoji(query);
    return EMOJI_GROUPS.find((g) => g.name === group)?.emoji ?? [];
  }, [query, group, searching]);

  const pick = (glyph: string) => {
    const next = pushRecent(recent, glyph);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — recents are a nicety, not worth failing a send */
    }
    onPick(glyph);
  };

  const nameOf = (glyph: string) =>
    ALL_EMOJI.find((e) => e.glyph === glyph)?.name ?? glyph;

  return (
    <div className="picker" ref={box} role="dialog" aria-label="Emoji">
      <input
        className="picker__search"
        autoFocus
        value={query}
        placeholder="Search emoji"
        onChange={(e) => setQuery(e.target.value)}
      />

      {!searching && (
        <div className="picker__tabs">
          {EMOJI_GROUPS.map((g) => (
            <button
              key={g.name}
              type="button"
              title={g.name}
              aria-label={g.name}
              className={`picker__tab${group === g.name ? " picker__tab--active" : ""}`}
              onClick={() => setGroup(g.name)}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}

      <div className="picker__body">
        {!searching && recent.length > 0 && (
          <>
            <div className="picker__heading">Recent</div>
            <div className="picker__grid">
              {recent.map((glyph) => (
                <button
                  key={`r-${glyph}`}
                  type="button"
                  className="picker__emoji"
                  title={nameOf(glyph)}
                  onClick={() => pick(glyph)}
                >
                  {glyph}
                </button>
              ))}
            </div>
            <div className="picker__heading">{group}</div>
          </>
        )}

        {shown.length === 0 ? (
          <p className="picker__empty">No emoji match “{query.trim()}”.</p>
        ) : (
          <div className="picker__grid">
            {shown.map((item) => (
              <button
                key={item.glyph}
                type="button"
                className="picker__emoji"
                title={item.name}
                onClick={() => pick(item.glyph)}
              >
                {item.glyph}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
