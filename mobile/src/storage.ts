// Session persistence. The token is a credential, so it goes into the platform
// keystore (expo-secure-store) rather than AsyncStorage.

import * as SecureStore from "expo-secure-store";

import { parseStoredSession, type MobileSession } from "./core/session";

const KEY = "arcadelauncher.session";

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
