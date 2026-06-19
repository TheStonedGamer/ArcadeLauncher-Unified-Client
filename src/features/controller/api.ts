// Per-emulator controller remap IPC. The Rust `controller` module owns the
// host-button → SDL-token model, persists one profile per emulator, and on
// apply writes the emulator's native pad config. This file is the typed IPC
// surface the remap editor uses; the pure profile helpers live in `profile.ts`.

import { call } from "../../lib/ipc";

/** A rebindable host (Xbox-style) button. */
export interface HostButton {
  id: string;
  label: string;
  defaultToken: string;
}

/** An emulator the editor can target. */
export interface ControllerTarget {
  id: string;
  name: string;
  /** A validated native writer exists, so apply writes its config to disk. */
  nativeWriter: boolean;
  /** The emulator runtime is installed locally (apply can run now). */
  installed: boolean;
}

/** One emulator's host-button → SDL-token map plus a stick dead zone. The map
 *  is partial: a missing host id falls back to that button's identity token. */
export interface Profile {
  deadZone: number;
  bindings: Record<string, string>;
}

/** Every saved profile, keyed by emulator id. */
export interface Profiles {
  profiles: Record<string, Profile>;
}

/** Outcome of applying a profile to an emulator's native config. */
export interface ApplyReport {
  applied: boolean;
  configPath: string;
  backupPath: string | null;
  biosMessages: string[];
  note: string | null;
}

export function controllerHostButtons(): Promise<HostButton[]> {
  return call<HostButton[]>("controller_host_buttons");
}

export function controllerSdlTokens(): Promise<string[]> {
  return call<string[]>("controller_sdl_tokens");
}

export function controllerTargets(): Promise<ControllerTarget[]> {
  return call<ControllerTarget[]>("controller_targets");
}

export function controllerLoadProfiles(): Promise<Profiles> {
  return call<Profiles>("controller_load_profiles");
}

export function controllerSaveProfile(emulatorId: string, profile: Profile): Promise<Profiles> {
  return call<Profiles>("controller_save_profile", { emulatorId, profile });
}

export function controllerApply(emulatorId: string): Promise<ApplyReport> {
  return call<ApplyReport>("controller_apply", { emulatorId });
}
