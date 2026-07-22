// Resolving a download row's display name. The queue keys everything on the
// opaque server game id (e.g. `pc-fdc100f88077`), so the UI needs a lookup to
// show something a human recognizes. Ids are opaque hex — there is nothing to
// "prettify" — so the only real fix is keeping the map populated and knowing
// when it isn't.
//
// Pure functions only; the React/IPC glue lives in AppShell.

/** Anything with the two catalog fields we need (keeps this decoupled from the
 *  full `Game` shape, so tests don't have to build 25-field fixtures). */
export interface TitledGame {
  id: string;
  title: string;
}

/** Build the `game id → title` lookup from a catalog. Entries with a blank or
 *  whitespace-only title are skipped: storing them would mask the id fallback
 *  and render an empty row label. */
export function buildTitleMap(games: readonly TitledGame[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of games) {
    const title = g.title.trim();
    if (g.id !== "" && title !== "") map[g.id] = title;
  }
  return map;
}

/** The label to show for `gameId`: its catalog title, or the raw id when the
 *  catalog has no entry (nothing better exists — the id is opaque). */
export function displayName(gameId: string, titles: Record<string, string> | undefined): string {
  const title = titles?.[gameId]?.trim();
  return title !== undefined && title !== "" ? title : gameId;
}

/** Ids present in the queue that the title map can't name, sorted so the result
 *  is a stable value an effect can compare against its previous run. Drives the
 *  catalog re-read: a fresh install has no cached library.json when the shell
 *  mounts, so without a retry every row would show its id forever. */
export function unknownIds(
  gameIds: readonly string[],
  titles: Record<string, string> | undefined,
): string[] {
  const missing = gameIds.filter((id) => {
    const title = titles?.[id]?.trim();
    return title === undefined || title === "";
  });
  return [...new Set(missing)].sort();
}
