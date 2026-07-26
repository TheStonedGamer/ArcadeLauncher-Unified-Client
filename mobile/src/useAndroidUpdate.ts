import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

import {
  compareVersions,
  selectApk,
  validateManifest,
  type AndroidApk,
} from "./update";

const UPDATE_MANIFEST = "https://arcade.orlandoaio.net/downloads/android-latest.json";
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const GRANT_READ_URI_PERMISSION = 1;

type Phase = "idle" | "checking" | "available" | "downloading" | "installing" | "error";

export interface AndroidUpdate {
  phase: Phase;
  version: string | null;
  error: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  openInstallSettings: () => Promise<void>;
}

function supportedAbis(): string[] {
  const constants = Platform.constants as unknown as {
    Supported64BitAbis?: string[];
    Supported32BitAbis?: string[];
  };
  return [
    ...(constants.Supported64BitAbis ?? []),
    ...(constants.Supported32BitAbis ?? []),
    // Nearly every physical phone we support is arm64. Keep it as a fallback
    // for React Native runtimes that do not expose ABI constants.
    "arm64-v8a",
  ];
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hashApk(uri: string): Promise<string> {
  // APKs are currently about 40 MB. Expo FileSystem exposes a content URI for
  // installation but not a streaming SHA-256 API, so read once from private
  // cache and hash its raw bytes through Expo's native crypto module.
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytesFromBase64(base64));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useAndroidUpdate(): AndroidUpdate {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [apk, setApk] = useState<AndroidApk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  const check = useCallback(async () => {
    if (Platform.OS !== "android") return;
    setPhase("checking");
    setError(null);
    try {
      const response = await fetch(UPDATE_MANIFEST, {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      });
      if (!response.ok) throw new Error(`update feed returned HTTP ${response.status}`);
      const manifest = validateManifest(await response.json());
      const installedVersion = Application.nativeApplicationVersion ?? "0.0.0";
      const installedCode = Number(Application.nativeBuildVersion ?? 0);
      if (
        compareVersions(manifest.version, installedVersion) <= 0 ||
        manifest.versionCode <= installedCode
      ) {
        if (active.current) {
          setVersion(null);
          setApk(null);
          setPhase("idle");
        }
        return;
      }
      const selected = selectApk(manifest, supportedAbis());
      if (active.current) {
        setVersion(manifest.version);
        setApk(selected.apk);
        setPhase("available");
      }
    } catch (cause) {
      if (active.current) {
        setPhase("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }, []);

  const install = useCallback(async () => {
    if (!apk || !version) return;
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
      setPhase("error");
      setError("Android update cache is unavailable");
      return;
    }
    const destination = `${cacheDirectory}arcadelauncher-${version}.apk`;
    setPhase("downloading");
    setError(null);
    try {
      await FileSystem.deleteAsync(destination, { idempotent: true });
      const downloaded = await FileSystem.downloadAsync(apk.url, destination);
      if (downloaded.status !== 200) throw new Error(`APK download returned HTTP ${downloaded.status}`);
      const info = await FileSystem.getInfoAsync(downloaded.uri);
      if (!info.exists || info.size !== apk.size) throw new Error("APK download size did not match the update manifest");
      const actualHash = await hashApk(downloaded.uri);
      if (actualHash.toLowerCase() !== apk.sha256.toLowerCase()) {
        throw new Error("APK SHA-256 did not match the signed update manifest");
      }
      setPhase("installing");
      const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: "application/vnd.android.package-archive",
        flags: GRANT_READ_URI_PERMISSION,
      });
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [apk, version]);

  const openInstallSettings = useCallback(async () => {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", {
      data: `package:${Application.applicationId ?? "net.orlandoaio.arcadelauncher.companion"}`,
    });
  }, []);

  useEffect(() => {
    active.current = true;
    void check();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      active.current = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, [check]);

  return { phase, version, error, check, install, openInstallSettings };
}
