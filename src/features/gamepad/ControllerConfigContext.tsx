// Shares the user's controller preferences (enable toggle + stick dead zone)
// with every `useGamepad` consumer. Loaded once from config.json on mount; the
// Settings form calls `refresh()` after a Save so a change applies live without
// a restart. Defaults match the Rust model + JS STICK_THRESHOLD.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { loadSettings } from "../settings/api";
import { STICK_THRESHOLD } from "./input";

export interface ControllerConfig {
  enabled: boolean;
  deadZone: number;
}

const DEFAULT: ControllerConfig = { enabled: true, deadZone: STICK_THRESHOLD };

interface ControllerConfigValue extends ControllerConfig {
  /** Re-read settings from disk (call after saving in the Settings form). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<ControllerConfigValue>({
  ...DEFAULT,
  refresh: async () => {},
});

export function ControllerConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ControllerConfig>(DEFAULT);

  const refresh = useCallback(async () => {
    try {
      const s = await loadSettings();
      setConfig({
        enabled: s.controllerEnabled,
        // Guard against a corrupt/out-of-range value on disk.
        deadZone: clampDeadZone(s.controllerDeadZone),
      });
    } catch {
      // Keep whatever we had; controller falls back to sensible defaults.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ ...config, refresh }}>{children}</Ctx.Provider>;
}

export function useControllerConfig(): ControllerConfigValue {
  return useContext(Ctx);
}

/** Keep the dead zone in a usable range so a bad config can't disable the
 *  stick entirely or make it hair-trigger. */
export function clampDeadZone(value: number): number {
  if (!Number.isFinite(value)) return STICK_THRESHOLD;
  return Math.min(0.95, Math.max(0.05, value));
}
