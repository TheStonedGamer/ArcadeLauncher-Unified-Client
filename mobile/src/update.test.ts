import { describe, expect, it } from "vitest";
import { compareVersions, selectApk, validateManifest } from "./update";

const manifest = {
  schemaVersion: 1 as const,
  version: "0.15.12",
  versionCode: 15012,
  generatedAt: "2026-07-26T00:00:00Z",
  apks: {
    "arm64-v8a": {
      url: "https://arcade.orlandoaio.net/downloads/companion-arm64.apk",
      sha256: "a".repeat(64),
      size: 123,
    },
  },
};

describe("Android update manifest", () => {
  it("compares semantic release versions", () => {
    expect(compareVersions("0.15.12", "0.15.11")).toBe(1);
    expect(compareVersions("0.15.11", "0.15.11")).toBe(0);
    expect(compareVersions("0.15.10", "0.15.11")).toBe(-1);
  });

  it("rejects malformed update data", () => {
    expect(() => validateManifest({ ...manifest, versionCode: 0 })).toThrow();
    expect(() => validateManifest({ ...manifest, apks: {} })).not.toThrow();
    expect(() => validateManifest({ ...manifest, apks: { arm64: { ...manifest.apks["arm64-v8a"], sha256: "bad" } } })).toThrow();
  });

  it("selects only a compatible architecture", () => {
    const parsed = validateManifest(manifest);
    expect(selectApk(parsed, ["x86_64", "arm64-v8a"]).abi).toBe("arm64-v8a");
    expect(() => selectApk(parsed, ["armeabi-v7a"])).toThrow();
  });
});
