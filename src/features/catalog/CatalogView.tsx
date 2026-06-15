// The catalog screen: a path input to pick library.json, a load button, the
// game grid, and a status/error line. This is the only place the catalog hook
// is consumed, keeping wiring in one spot.

import { useState } from "react";
import { useCatalog } from "./useCatalog";
import { CatalogGrid } from "./components/CatalogGrid";

export function CatalogView() {
  const { games, loading, error, status, load, launch } = useCatalog();
  const [path, setPath] = useState("");

  return (
    <section className="catalog">
      <form
        className="catalog__bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (path.trim()) load(path.trim());
        }}
      >
        <input
          className="catalog__path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Path to library.json"
          spellCheck={false}
        />
        <button className="catalog__load" type="submit" disabled={loading || !path.trim()}>
          {loading ? "Loading…" : "Load catalog"}
        </button>
      </form>

      {error && <p className="catalog__error">{error}</p>}
      {!error && status && <p className="catalog__status">{status}</p>}

      <CatalogGrid games={games} onLaunch={launch} />
    </section>
  );
}
