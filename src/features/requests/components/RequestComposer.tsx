// Search-and-request composer: search IGDB for a release, pick a hit, add an
// optional note, and submit. If the chosen hit is already on the board it shows
// "Upvote" instead of "Request" (the service dedupes by IGDB id into an upvote).
// Pure helpers (alreadyRequested, requestSubtitle) come from requests.ts.

import { useState } from "react";
import { alreadyRequested, releaseYear, type GameRequest, type SearchHit } from "../requests";

interface RequestComposerProps {
  board: GameRequest[];
  /** Returns search hits; resolves to [] when signed out or query is blank. */
  search: (query: string, platform?: string) => Promise<SearchHit[]>;
  /** Create (or upvote a dupe of) a request from a chosen hit + note. */
  request: (hit: SearchHit, note: string) => Promise<void>;
  disabled?: boolean;
}

export function RequestComposer({ board, search, request, disabled }: RequestComposerProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !query.trim()) return;
    setSearching(true);
    setMsg(null);
    setSelected(null);
    try {
      setHits(await search(query));
    } catch (err) {
      setMsg(String(err));
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await request(selected, note);
      const dupe = alreadyRequested(selected, board);
      setMsg(dupe ? `Upvoted “${selected.name}”.` : `Requested “${selected.name}”.`);
      setSelected(null);
      setNote("");
      setHits([]);
      setQuery("");
    } catch (err) {
      setMsg(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reqcompose">
      <form className="reqcompose__search" onSubmit={runSearch}>
        <input
          className="reqcompose__input"
          placeholder="Search for a game to request…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled || busy}
        />
        <button className="reqcompose__btn" type="submit" disabled={disabled || searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {disabled && <p className="reqcompose__hint">Sign in to request a game.</p>}

      {hits.length > 0 && (
        <ul className="reqcompose__hits">
          {hits.map((h) => {
            const dupe = alreadyRequested(h, board);
            const year = releaseYear(h.releaseDate);
            const isSel = selected?.igdbId === h.igdbId && selected?.name === h.name;
            return (
              <li
                key={`${h.igdbId}-${h.name}`}
                className={`reqcompose__hit${isSel ? " reqcompose__hit--sel" : ""}`}
                onClick={() => setSelected(h)}
              >
                {h.coverUrl && <img className="reqcompose__cover" src={h.coverUrl} alt="" />}
                <span className="reqcompose__hitmain">
                  <span className="reqcompose__hitname">{h.name}</span>
                  <span className="reqcompose__hitsub">
                    {[h.platforms, year].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {dupe && <span className="reqcompose__dupe">on board</span>}
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="reqcompose__confirm">
          <input
            className="reqcompose__input"
            placeholder="Optional note (why you want it)…"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          <button className="reqcompose__btn reqcompose__btn--primary" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : alreadyRequested(selected, board) ? "Upvote" : "Request"}
          </button>
        </div>
      )}

      {msg && <p className="reqcompose__msg">{msg}</p>}
    </div>
  );
}
