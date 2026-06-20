// Pure first-run onboarding content + step navigation. The overlay (thin React)
// drives these; step math is unit-tested (onboarding.test.ts).

export interface OnboardingStep {
  id: string;
  title: string;
  body: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to ArcadeLauncher",
    body: "Your whole game library — emulator ROMs, PC storefront installs, and server-hosted games — in one place.",
  },
  {
    id: "signin",
    title: "Sign in to your server",
    body: "Use Sign in (top-right) to connect to your ArcadeLauncher server and sync your catalog, cloud saves, and friends.",
  },
  {
    id: "play",
    title: "Pick up where you left off",
    body: "Recently played games show up in the Continue Playing row at the top of your library. Click any cover to launch instantly.",
  },
  {
    id: "social",
    title: "Friends, chat & voice",
    body: "The Friends tab has presence, chat, and peer-to-peer voice. See who's online and jump into a game together.",
  },
  {
    id: "personalize",
    title: "Make it yours",
    body: "Open Settings to choose a theme and accent color, set a global summon hotkey, and tune controller navigation. Press ? anytime to see all shortcuts.",
  },
];

/** Legacy pre-per-user flag: a single global "onboarding seen" marker. */
export const LEGACY_ONBOARDING_KEY = "onboarding.done";

/** Per-user "onboarding seen" storage key, so each account sees the tour once. */
export function onboardingDoneKey(user: string): string {
  return `onboarding.done:${user}`;
}

/**
 * Decide whether the first-run tour is already complete for the signed-in user.
 * Pure: takes a storage `read`. Not signed in (no user) → treated as complete so
 * the overlay never shows before login — the tour is gated on a user's first
 * login, not on app first-run. A legacy global flag from pre-per-user installs
 * also counts as complete, so existing users aren't re-nagged after upgrading.
 */
export function isOnboardingComplete(
  user: string | null | undefined,
  read: (key: string) => string | null,
): boolean {
  if (!user) return true;
  if (read(onboardingDoneKey(user)) === "1") return true;
  if (read(LEGACY_ONBOARDING_KEY) === "1") return true;
  return false;
}

/** Clamp a step index into [0, total-1] (0 when empty). */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** True when `index` is the final step (so the overlay shows "Get started"). */
export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}
