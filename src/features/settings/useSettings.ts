// Loads General settings on mount and persists edits. Keeps a local draft so
// the form is responsive; `save` writes the draft to disk via Rust.

import { useCallback, useEffect, useState } from "react";
import { loadSettings, saveSettings } from "./api";
import type { GeneralSettings } from "./types";

const DEFAULTS: GeneralSettings = {
  libraryPath: "",
  closeToTray: true,
  launchMinimized: false,
  confirmOnExit: false,
  downloadLimitKbps: 0,
  concurrentDownloads: 3,
  theme: "dark",
  igdbClientId: "",
  igdbClientSecret: "",
};

export function useSettings() {
  const [draft, setDraft] = useState<GeneralSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setDraft(await loadSettings());
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = useCallback(<K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    setError(null);
    try {
      await saveSettings(draft);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  }, [draft]);

  return { draft, loading, saved, error, set, save };
}
