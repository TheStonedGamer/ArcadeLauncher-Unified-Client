// The Arcade Store tab: browse the WHOLE server catalog (owned or not) as Steam-
// style capsules and add games to your library. Installing/launching stays in
// the Library tab — the Store is purely discovery + ownership. The full catalog
// comes from the same useCatalog hook the Library uses (local cache first, then
// a server sync once signed in), so both tabs share one source of truth.

import { useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "../catalog/useCatalog";
import { useSession } from "../session/SessionContext";
import type { Ownership } from "../catalog/useOwnership";
import type { Game } from "../catalog/types";
import { StoreCapsule } from "./StoreCapsule";
import { StoreFeatured } from "./StoreFeatured";
import { StoreDetail } from "./StoreDetail";
import { useInstallOverlay } from "../download/useInstallOverlay";
import { effectiveInstallState } from "../download/installState";
import { isInstalledWithoutOwnership } from "../catalog/ownershipDisplay";
import { recommendations, rotate, taste } from "./recommend";

/** How many recommendations the hero cycles through. */
const FEATURED_PICKS = 6;
/** Dwell time per pick. Long enough to read the blurb, short enough to notice. */
const ROTATE_MS = 9000;

export function ArcadeStoreView({ ownership }: { ownership: Ownership }) {
  const { session } = useSession();
  const { games, loading, error, load, syncFromServer } = useCatalog();
  const { states: installOverlay } = useInstallOverlay(session);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [selected, setSelected] = useState<Game | null>(null);
  const autoLoaded = useRef(false);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    if (syncedFor.current === session.token) return;
    syncedFor.current = session.token;
    void syncFromServer(session.host, session.token);
  }, [session, syncFromServer]);

  const liveGames = useMemo(
    () =>
      games.map((g) => {
        const state = effectiveInstallState(g.id, g.installState, installOverlay);
        return state === g.installState ? g : { ...g, installState: state };
      }),
    [games, installOverlay],
  );

  const platforms = useMemo(
    () => [...new Set(liveGames.map((g) => g.platform).filter(Boolean))].sort(),
    [liveGames],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return liveGames.filter((g) => {
      if (platform !== "all" && g.platform !== platform) return false;
      if (q && !g.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [liveGames, query, platform]);

  // Featured = a rotating shortlist recommended from tracked playtime, shown
  // only when browsing unfiltered. It used to be one fixed highest-rated game,
  // which never changed and ignored the player entirely.
  const picks = useMemo(
    () => (query || platform !== "all" ? [] : recommendations(liveGames, FEATURED_PICKS)),
    [liveGames, query, platform],
  );
  const [tick, setTick] = useState(0);
  // Advance on a timer; restart only when the shortlist's *contents* change, so
  // an unrelated re-render (an install-progress tick, say) can't keep resetting
  // the rotation to the first pick.
  const picksKey = picks.map((p) => p.id).join(",");
  useEffect(() => {
    setTick(0);
    const count = picksKey ? picksKey.split(",").length : 0;
    if (count < 2) return;
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [picksKey]);
  const featured = rotate(picks, tick);
  // Whether the shortlist reflects actual play history, or is just the
  // highest-rated fallback for an account that hasn't played anything yet.
  const personalized = useMemo(() => taste(liveGames).totalSeconds > 0, [liveGames]);

  return (
    <section className="astore">
      <div className="astore__subnav">
        <span className="astore__brand">Store</span>
        <div className="astore__search-wrap">
          <input
            className="astore__search"
            type="search"
            placeholder="search the library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
        <select
          className="astore__filter"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option value="all">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <span className="astore__count">{filtered.length}</span>
      </div>

      {loading && games.length === 0 && <p className="catalog__status">Loading store…</p>}
      {error && <p className="catalog__error">{error}</p>}
      {!session && (
        <p className="astore__signin">
          Sign in to add games to your library.
        </p>
      )}

      {featured && (
        <StoreFeatured
          game={featured}
          owned={ownership.isOwned(featured.id)}
          canModify={!!session}
          onOpen={() => setSelected(featured)}
          onToggle={() => toggle(featured, ownership)}
          count={picks.length}
          index={picks.indexOf(featured)}
          onSelect={setTick}
          personalized={personalized}
          installedNotOwned={isInstalledWithoutOwnership(
            featured,
            ownership.loaded ? ownership.ownedIds : undefined,
          )}
        />
      )}

      <h2 className="astore__heading">Browse the library</h2>
      <div className="astore__grid">
        {filtered.map((g) => (
          <StoreCapsule
            key={g.id}
            game={g}
            owned={ownership.isOwned(g.id)}
            canModify={!!session}
            onOpen={() => setSelected(g)}
            onToggle={() => toggle(g, ownership)}
            installedNotOwned={isInstalledWithoutOwnership(
              g,
              ownership.loaded ? ownership.ownedIds : undefined,
            )}
          />
        ))}
      </div>

      {selected && (
        <StoreDetail
          game={selected}
          owned={ownership.isOwned(selected.id)}
          canModify={!!session}
          onToggle={() => toggle(selected, ownership)}
          onClose={() => setSelected(null)}
          installedNotOwned={isInstalledWithoutOwnership(
            selected,
            ownership.loaded ? ownership.ownedIds : undefined,
          )}
        />
      )}
    </section>
  );
}

// Add or remove, swallowing the rejection (the optimistic state already rolled
// back inside the hook; a toast layer can surface it later if desired).
function toggle(game: Game, ownership: Ownership) {
  const p = ownership.isOwned(game.id)
    ? ownership.remove(game.id)
    : ownership.add(game.id);
  void p.catch(() => {});
}
