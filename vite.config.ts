/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vitest. The suite is all pure, synchronous KATs (no real IO), so any single
  // test finishing is near-instant. The default 5s per-test timeout, however, is
  // measured against wall-clock — on the self-hosted Windows CI runner under load
  // the whole vitest process can stall long enough to trip it on a trivial test
  // (observed: a sync string-format test in ra.test.ts timing out at 5000ms).
  // Raise the ceiling generously so runner contention can't red the build; a
  // genuinely hung test still fails, just later.
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
