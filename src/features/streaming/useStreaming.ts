// React glue for remote streaming: the host registry (pair / forget / refresh),
// Moonlight availability, launching a stream, and the locally-persisted
// stream-quality defaults. Pure logic (clamping, parsing, PIN validation) lives
// in streaming.ts; this hook only orchestrates the IPC + localStorage seams.

import { useCallback, useEffect, useState } from "react";
import {
  hostPair,
  moonlightAvailable,
  streamLaunch,
  streamingForgetHost,
  streamingHosts,
  type StreamHost,
} from "./api";
import {
  DEFAULT_STREAM_SETTINGS,
  parseStoredSettings,
  sanitizeSettings,
  type StreamSettings,
} from "./streaming";

const SETTINGS_KEY = "streaming.defaults";

/** Read persisted stream-quality defaults (clamped), defaulting on any error. */
function loadStreamSettings(): StreamSettings {
  try {
    return parseStoredSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_STREAM_SETTINGS };
  }
}

/** Persist stream-quality defaults (sanitized). Best-effort. */
function saveStreamSettings(s: StreamSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s)));
  } catch {
    /* storage unavailable — keep the in-memory draft */
  }
}

export function useStreaming() {
  const [hosts, setHosts] = useState<StreamHost[]>([]);
  const [moonlight, setMoonlight] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<StreamSettings>(loadStreamSettings);

  const refresh = useCallback(async () => {
    try {
      setHosts(await streamingHosts());
    } catch {
      setHosts([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    moonlightAvailable()
      .then(setMoonlight)
      .catch(() => setMoonlight(false));
  }, [refresh]);

  const setDefaults = useCallback((s: StreamSettings) => {
    const clamped = sanitizeSettings(s);
    setSettings(clamped);
    saveStreamSettings(clamped);
  }, []);

  const pair = useCallback(
    async (address: string, pin: string, name: string) => {
      const ok = await hostPair(address, pin, name);
      await refresh();
      return ok;
    },
    [refresh],
  );

  const forget = useCallback(
    async (address: string) => {
      const removed = await streamingForgetHost(address);
      await refresh();
      return removed;
    },
    [refresh],
  );

  const launch = useCallback(
    (address: string, app: string) => streamLaunch(address, app, settings),
    [settings],
  );

  return { hosts, moonlight, settings, setDefaults, refresh, pair, forget, launch };
}
