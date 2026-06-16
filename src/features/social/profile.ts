// Pure profile/level helpers (ROADMAP T9d). The server stores XP and returns the
// computed level on each profile fetch; these mirror its `level_for_xp`
// (floor(sqrt(xp/100))) so the client can also render a level-progress bar
// without a round-trip. Deterministic and IO-free → unit-tested in profile.test.ts.

/** A user's public profile, mirroring `GET /api/social/profile/:id`. */
export interface Profile {
  userId: number;
  username: string;
  avatarVersion: number;
  /** Banner color/gradient/URL string, or "" when unset. */
  banner: string;
  /** Free-text bio, or "" when unset. */
  bio: string;
  level: number;
  xp: number;
}

/** Level for a given XP total: floor(sqrt(xp/100)). Non-positive XP → level 0. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 0;
  return Math.floor(Math.sqrt(xp / 100));
}

/** XP threshold at which `level` begins: level²·100. Non-positive → 0. */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  return level * level * 100;
}

/** Progress within the current level, for a progress bar. `into`/`span` are XP
 *  amounts; `pct` is 0–100. */
export interface LevelProgress {
  level: number;
  /** XP earned into the current level. */
  into: number;
  /** Total XP between this level and the next. */
  span: number;
  /** XP total at which the next level starts. */
  next: number;
  /** Fraction through the current level, 0–100. */
  pct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = Math.max(0, xp) - base;
  const pct = span > 0 ? Math.min(100, Math.max(0, (into / span) * 100)) : 0;
  return { level, into, span, next, pct };
}
