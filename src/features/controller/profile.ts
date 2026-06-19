// Pure helpers for the controller remap editor. Kept free of React/IPC so the
// binding logic (identity fallback, dirtiness, clamping, normalization) is unit
// testable in isolation — mirrors the Rust `Profile` semantics on the JS side.

import type { HostButton, Profile } from "./api";

/** The dead zone the launcher and emulators default to. */
export const DEFAULT_DEAD_ZONE = 0.15;

/** An empty profile at the default dead zone (the identity mapping, since every
 *  host button falls back to its own default token when unbound). */
export function emptyProfile(): Profile {
  return { deadZone: DEFAULT_DEAD_ZONE, bindings: {} };
}

/** The SDL token bound to `hostId`, falling back to the button's identity token.
 *  Unknown ids return "" (the caller treats that as "leave at default"). */
export function tokenFor(profile: Profile, buttons: HostButton[], hostId: string): string {
  const explicit = profile.bindings[hostId];
  if (explicit) return explicit;
  return buttons.find((b) => b.id === hostId)?.defaultToken ?? "";
}

/** Clamp a dead zone to the editor's allowed 5%–95% band, rounded to whole
 *  percents (the slider's granularity), expressed as a 0..1 float. */
export function clampDeadZone(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_DEAD_ZONE;
  const pct = Math.round(value * 100);
  return Math.min(95, Math.max(5, pct)) / 100;
}

/** Set `hostId`'s binding. Selecting the button's identity token clears the
 *  explicit entry so the saved profile stays minimal (and matches the Rust
 *  semantics where a missing entry means "identity"). */
export function setBinding(
  profile: Profile,
  buttons: HostButton[],
  hostId: string,
  token: string,
): Profile {
  const identity = buttons.find((b) => b.id === hostId)?.defaultToken;
  const bindings = { ...profile.bindings };
  if (token === identity) {
    delete bindings[hostId];
  } else {
    bindings[hostId] = token;
  }
  return { ...profile, bindings };
}

/** Reset to the identity mapping at the default dead zone. */
export function resetProfile(): Profile {
  return emptyProfile();
}

/** Whether `a` and `b` describe the same effective mapping. Compares the
 *  resolved token for every host button (so `{}` and an all-identity explicit
 *  map are equal) plus the dead zone. */
export function profilesEqual(a: Profile, b: Profile, buttons: HostButton[]): boolean {
  if (Math.round(a.deadZone * 100) !== Math.round(b.deadZone * 100)) return false;
  return buttons.every((btn) => tokenFor(a, buttons, btn.id) === tokenFor(b, buttons, btn.id));
}
