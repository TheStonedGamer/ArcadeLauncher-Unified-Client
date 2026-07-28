// Session persistence. The token is a credential, so it goes into the platform
// keystore (expo-secure-store) rather than AsyncStorage.

import * as SecureStore from "expo-secure-store";

import { parseStoredSession, type MobileSession } from "./core/session";
import { parseSettings, DEFAULT_SETTINGS, type MobileSettings } from "./core/settings";

const KEY = "arcadelauncher.session";
const SETTINGS_KEY = "arcadelauncher.settings";

export async function loadSession(): Promise<MobileSession | null> {
  try {
    return parseStoredSession(await SecureStore.getItemAsync(KEY));
  } catch {
    return null; // A keystore that won't open is the same as "not signed in".
  }
}

export async function saveSession(session: MobileSession): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  } catch {
    // Non-fatal: the user stays signed in for this run, just not the next one.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing to do — the caller drops the in-memory session either way.
  }
}

// Settings are preferences, not credentials, but they live in the same store to
// avoid pulling in a second persistence library for two objects of booleans.

export async function loadSettings(): Promise<MobileSettings> {
  try {
    return parseSettings(await SecureStore.getItemAsync(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS; // Unreadable settings must never block a call.
  }
}

export async function saveSettings(settings: MobileSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: the change applies for this run, just not the next one.
  }
}
