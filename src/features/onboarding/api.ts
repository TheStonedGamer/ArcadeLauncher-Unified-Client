// Typed IPC for the account-level onboarding flag (src-tauri/src/social/
// commands.rs). The "first-run tour seen" state is stored server-side in the
// per-account prefs blob so it survives reinstalls and follows the user across
// devices — the tour shows once per account, not once per device. localStorage
// (see useOnboarding) is only a fast, offline cache on top of this.

import { call } from "../../lib/ipc";

/** Whether this account has already completed the onboarding tour (server truth). */
export function fetchOnboardingComplete(host: string, token: string): Promise<boolean> {
  return call<boolean>("onboarding_get", { host, token });
}

/** Mark the onboarding tour complete for this account (server-side, cross-device). */
export function markOnboardingComplete(host: string, token: string): Promise<void> {
  return call<void>("onboarding_complete", { host, token });
}
