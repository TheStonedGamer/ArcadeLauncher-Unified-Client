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

/** Clamp a step index into [0, total-1] (0 when empty). */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** True when `index` is the final step (so the overlay shows "Get started"). */
export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}
