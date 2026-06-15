// ROM-dump variant logic, ported from the C++ client's variants:: (byte-for-byte
// on the ASCII dump tags). Different dumps of one game — Crystalis (U), [a1],
// (Prototype), SMB3 (PRG 1) [a2] — clean to an identical display title; the grid
// collapses them under one tile and offers a picker. fileStem/label/score decide
// the representative and how each dump is labeled.

import type { Game } from "./types";

function toLower(s: string): string {
  return s.toLowerCase();
}

/** Filename leaf of contentPath without extension; falls back to the title. */
export function fileStem(contentPath: string, titleFallback: string): string {
  let s = contentPath;
  const slash = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (slash >= 0) s = s.slice(slash + 1);
  const dot = s.lastIndexOf(".");
  if (dot > 0) s = s.slice(0, dot);
  return s || titleFallback;
}

/** Games sharing a key are dumps of the same logical game. */
export function variantKey(game: Game): string {
  return `${game.platform}|${toLower(game.title)}`;
}

/** Short label distinguishing one dump from its siblings ("" for a base dump). */
export function variantLabel(game: Game): string {
  const low = toLower(fileStem(game.contentPath, game.title));
  const has = (x: string) => low.includes(x);
  const parts: string[] = [];
  if (has("[!]")) parts.push("Verified");
  if (has("prototype") || has("proto")) parts.push("Prototype");
  if (has("prg 1") || has("prg1")) parts.push("PRG 1");
  if (has("trad-en") || has("t-en") || has("[t+en") || has("[tr en")) parts.push("Eng patch");
  const ap = low.indexOf("[a");
  if (ap >= 0 && ap + 2 < low.length && /\d/.test(low[ap + 2])) parts.push(`Alt ${low[ap + 2]}`);
  if (has("[b")) parts.push("Bad dump");
  if (has("[h")) parts.push("Hack");
  if (has("[p")) parts.push("Pirate");
  return parts.join(", ");
}

/** Lower score = better default pick for the grouped tile. */
export function variantScore(game: Game): number {
  let s = 100;
  const installedServerCopy = game.serverBacked && game.installState === "installed";
  if (installedServerCopy) s -= 1000;
  const low = toLower(fileStem(game.contentPath, game.title));
  const has = (x: string) => low.includes(x);
  if (has("[!]")) s -= 50;
  if (has("[a")) s += 15;
  if (has("prototype") || has("proto")) s += 40;
  if (has("[b")) s += 60;
  if (has("[h") || has("[p") || has("[t")) s += 30;
  if (has("(u)") || has("(usa)")) s -= 5;
  return s;
}

export interface VariantGroup {
  key: string;
  /** Best-scoring dump — the tile shown in the grid. */
  representative: Game;
  /** All dumps in the group, best-first; length 1 means no real variants. */
  members: Game[];
}

/** Collapse dumps of the same game into groups, preserving the input order of
 *  first appearance (so a sorted list stays sorted by its representatives). */
export function groupVariants(games: Game[]): VariantGroup[] {
  const byKey = new Map<string, Game[]>();
  const order: string[] = [];
  for (const g of games) {
    const k = variantKey(g);
    if (!byKey.has(k)) {
      byKey.set(k, []);
      order.push(k);
    }
    byKey.get(k)!.push(g);
  }
  return order.map((key) => {
    const members = byKey.get(key)!.slice().sort((a, b) => variantScore(a) - variantScore(b));
    return { key, representative: members[0], members };
  });
}
