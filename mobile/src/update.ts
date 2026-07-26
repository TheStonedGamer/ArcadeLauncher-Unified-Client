export interface AndroidApk {
  url: string;
  sha256: string;
  size: number;
}

export interface AndroidUpdateManifest {
  schemaVersion: 1;
  version: string;
  versionCode: number;
  generatedAt: string;
  apks: Record<string, AndroidApk>;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`invalid version: ${value}`);
    return Number(part);
  });
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

export function validateManifest(value: unknown): AndroidUpdateManifest {
  const manifest = value as Partial<AndroidUpdateManifest>;
  const versionCode = manifest.versionCode;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.version !== "string" ||
    typeof versionCode !== "number" ||
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    !manifest.apks ||
    typeof manifest.apks !== "object"
  ) {
    throw new Error("invalid Android update manifest");
  }
  compareVersions(manifest.version, "0.0.0");
  for (const [abi, apk] of Object.entries(manifest.apks)) {
    if (
      !abi ||
      !apk ||
      typeof apk.url !== "string" ||
      !/^https:\/\//i.test(apk.url) ||
      !/^[a-f0-9]{64}$/i.test(apk.sha256) ||
      !Number.isSafeInteger(apk.size) ||
      apk.size < 1
    ) {
      throw new Error(`invalid APK entry for ${abi}`);
    }
  }
  return manifest as AndroidUpdateManifest;
}

export function selectApk(
  manifest: AndroidUpdateManifest,
  supportedAbis: readonly string[],
): { abi: string; apk: AndroidApk } {
  for (const abi of supportedAbis) {
    const apk = manifest.apks[abi];
    if (apk) return { abi, apk };
  }
  throw new Error("no update APK matches this Android device");
}
