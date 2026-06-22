// React glue for remote streaming: the host registry (pair / forget / refresh),
// Moonlight availability, launching a stream, and the locally-persisted
// stream-quality defaults. Pure logic (clamping, parsing, PIN validation) lives
// in streaming.ts; this hook only orchestrates the IPC + localStorage seams.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  engineStreamAvailable,
  hostPair,
  moonlightAvailable,
  STREAM_STATE_EVENT,
  streamLaunch,
  streamStart,
  streamStop,
  streamingForgetHost,
  streamingHosts,
  type StreamHost,
} from "./api";
import {
  DEFAULT_STREAM_SETTINGS,
  isStreamTerminal,
  parseStoredSettings,
  parseStreamState,
  sanitizeSettings,
  type StreamSettings,
  type StreamState,
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
  const [engine, setEngine] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<StreamSettings>(loadStreamSettings);
  // The current engine stream's live phase, or null when nothing is streaming.
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  // Latest setter for the event listener (registered once; avoids re-subscribing).
  const stateRef = useRef(setStreamState);
  stateRef.current = setStreamState;

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
    engineStreamAvailable()
      .then(setEngine)
      .catch(() => setEngine(false));
  }, [refresh]);

  // Subscribe once to live engine stream-state events; clear to idle on a
  // terminal phase. The raw payload is parsed by the shared pure core.
  useEffect(() => {
    const un = listen(STREAM_STATE_EVENT, (e) => {
      const s = parseStreamState(e.payload);
      stateRef.current(isStreamTerminal(s.phase) ? null : s);
    });
    return () => {
      void un.then((u) => u());
    };
  }, []);

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

  // External-Moonlight launch (fallback / explicit). Fire-and-forget: Moonlight
  // owns its own window and we get no live state back.
  const launch = useCallback(
    (address: string, app: string) => streamLaunch(address, app, settings),
    [settings],
  );

  // Preferred playback: stream in-engine when the bundled engine is present
  // (live state via STREAM_STATE_EVENT), else fall back to external Moonlight.
  // Returns "engine" | "moonlight" so the UI can tailor its message.
  const play = useCallback(
    async (address: string, app: string): Promise<"engine" | "moonlight"> => {
      if (engine) {
        stateRef.current({ phase: "", reason: "" }); // show "starting" immediately
        try {
          await streamStart(address, app, settings);
          return "engine";
        } catch (e) {
          stateRef.current(null); // start failed — back to idle, surface to caller
          throw e;
        }
      }
      await streamLaunch(address, app, settings);
      return "moonlight";
    },
    [engine, settings],
  );

  // Stop the current engine stream (no-op for the Moonlight path).
  const stop = useCallback(async () => {
    try {
      await streamStop();
    } finally {
      stateRef.current(null);
    }
  }, []);

  return {
    hosts,
    moonlight,
    engine,
    settings,
    streamState,
    setDefaults,
    refresh,
    pair,
    forget,
    launch,
    play,
    stop,
  };
}
