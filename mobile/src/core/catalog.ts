// Pure catalog core for the mobile companion (ROADMAP T12l): parse the server's
// `/api/catalog` response, then search / filter / group it for a phone-sized
// list. Deliberately a *thin* mirror of the desktop model — the companion browses
// and requests; it doesn't own installs, prefs or cover caching.

/** The subset of the server catalog entry the companion actually shows. */
export interface MobileGame {
  id: string;
  title: string;
  platform: string;
  genres: string;
  developer: string;
  releaseDate: number;
  coverArtUrl: string;
  summary: string;
  sizeBytes: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Narrow one catalog entry. Requires an id and a title — anything else is a
 *  row we could not render or launch a request for. */
export function parseGame(value: unknown): MobileGame | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const id = str(v.id);
  const title = str(v.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    platform: str(v.platform),
    genres: str(v.genres),
    developer: str(v.developer),
    releaseDate: num(v.releaseDate),
    coverArtUrl: str(v.coverArtUrl),
    summary: str(v.summary),
    sizeBytes: num(v.sizeBytes),
  };
}

/** Parse the catalog response, accepting both the bare array (library.json's
 *  own shape) and the `{ games: [...] }` envelope, exactly as the desktop
 *  loader does. Unusable rows are skipped rather than failing the whole list. */
export function parseCatalog(body: unknown): MobileGame[] {
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { games?: unknown }).games)
      ? ((body as { games: unknown[] }).games)
      : [];
  return rows.map(parseGame).filter((g): g is MobileGame => g !== null);
}

/** Case/diacritic-insensitive substring match across the fields a user would
 *  reasonably search by. An empty query matches everything. */
export function matchesSearch(game: MobileGame, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [game.title, game.platform, game.genres, game.developer].some((f) => f.toLowerCase().includes(q));
}

/** Search + optional platform filter, alphabetical by title. */
export function filterGames(games: MobileGame[], query: string, platform = ""): MobileGame[] {
  return games
    .filter((g) => (!platform || g.platform === platform) && matchesSearch(g, query))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** Distinct platforms present, alphabetical. Blank platforms are omitted — an
 *  unlabelled filter chip helps nobody. */
export function platformsOf(games: MobileGame[]): string[] {
  return [...new Set(games.map((g) => g.platform).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/** "12.3 GB" — sizes come off the wire in bytes. "—" when unknown. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Release year for the list subtitle; "" when the catalog has no date. */
export function releaseYear(game: MobileGame): string {
  if (!game.releaseDate) return "";
  const d = new Date(game.releaseDate * 1000);
  const year = d.getUTCFullYear();
  return Number.isFinite(year) ? String(year) : "";
}

/** The one-line subtitle under a title in the list. */
export function gameSubtitle(game: MobileGame): string {
  return [game.platform, releaseYear(game)].filter(Boolean).join(" · ");
}
