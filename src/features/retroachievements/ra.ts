// Pure RetroAchievements display helpers (T12a). RA "points" are mapped onto the
// launcher's own level curve (the same floor(sqrt(xp/100)) the social profile
// uses) so a player's RA mastery previews as a launcher level — the seam for a
// future server-side XP sync. Deterministic + IO-free → unit-tested in ra.test.ts.

import { levelForXp } from "../social/profile";
import type { RaSummary, RaUnlock } from "./api";

/** The launcher level a user's RA point total maps to, reusing the shared level
 *  curve so RA progress reads on the same scale as social XP. */
export function pointsToLevel(points: number): number {
  return levelForXp(points);
}

/** Total points across a set of unlocks (e.g. this period's haul). */
export function unlockPoints(unlocks: RaUnlock[]): number {
  return unlocks.reduce((sum, u) => sum + (u.points || 0), 0);
}

/** The most recent `n` unlocks, newest first (RA returns newest-first, but sort
 *  defensively in case the order ever changes). Ties keep input order. */
export function topUnlocks(unlocks: RaUnlock[], n: number): RaUnlock[] {
  return [...unlocks]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, Math.max(0, n));
}

/** A short one-line label for an unlock, e.g. "First Blood · DOOM · 5pts ★". */
export function unlockLabel(u: RaUnlock): string {
  const parts = [u.title];
  if (u.gameTitle) parts.push(u.gameTitle);
  parts.push(`${u.points}pts`);
  return parts.join(" · ") + (u.hardcore ? " ★" : "");
}

/** A compact headline for the panel header, e.g. "12,345 pts · Rank #678". */
export function summaryHeadline(s: RaSummary): string {
  const pts = s.score.toLocaleString();
  return s.rank > 0 ? `${pts} pts · Rank #${s.rank.toLocaleString()}` : `${pts} pts`;
}
