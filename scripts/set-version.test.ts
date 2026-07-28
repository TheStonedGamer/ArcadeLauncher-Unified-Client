import { describe, expect, it } from "vitest";

import { setCargoVersion, setJsonVersion, versionFromTag } from "./set-version.mjs";

describe("versionFromTag", () => {
  it("strips the leading v", () => {
    expect(versionFromTag("v0.15.30")).toBe("0.15.30");
    expect(versionFromTag("0.15.30")).toBe("0.15.30");
  });

  it("rejects anything that is not exactly three numbers", () => {
    // These would silently produce installer filenames the updater cannot
    // compare, which is the failure this whole script exists to prevent.
    for (const bad of ["v1.2", "v1.2.3.4", "v1.2.3-rc1", "v1.2.x", "", "v01.2.3", "v1.2.1000"]) {
      expect(() => versionFromTag(bad)).toThrow();
    }
  });
});

describe("setCargoVersion", () => {
  const manifest = [
    "[package]",
    'name = "arcade_launcher"',
    'version = "0.15.28"',
    "",
    "[dependencies]",
    'tauri = { version = "2", features = [] }',
    'serde = "1.0.28"',
    "",
  ].join("\n");

  it("rewrites the package version", () => {
    expect(setCargoVersion(manifest, "0.15.30")).toContain('version = "0.15.30"');
  });

  it("leaves dependency versions alone", () => {
    const out = setCargoVersion(manifest, "0.15.30");
    expect(out).toContain('tauri = { version = "2", features = [] }');
    expect(out).toContain('serde = "1.0.28"');
  });

  it("refuses a manifest it does not understand", () => {
    expect(() => setCargoVersion('[dependencies]\nserde = "1"\n', "1.0.0")).toThrow();
    expect(() => setCargoVersion('[package]\nname = "x"\n', "1.0.0")).toThrow();
  });
});

describe("setJsonVersion", () => {
  it("replaces the version and keeps every other key", () => {
    const out = setJsonVersion('{\n  "name": "app",\n  "version": "0.15.28",\n  "x": 1\n}\n', "0.15.30");
    const doc = JSON.parse(out);
    expect(doc).toEqual({ name: "app", version: "0.15.30", x: 1 });
    expect(out.endsWith("\n")).toBe(true);
  });

  it("touches nothing but the version line", () => {
    // tauri.conf.json keeps its bundle targets inline; a reformat here would
    // bury the real change in churn and is easy to not notice in review.
    const text = '{\n  "version": "0.15.28",\n  "bundle": {\n    "targets": ["nsis", "msi"],\n    "version": "nested"\n  }\n}\n';
    const out = setJsonVersion(text, "0.15.30");
    expect(out).toBe(text.replace('"0.15.28"', '"0.15.30"'));
    expect(JSON.parse(out).bundle.version).toBe("nested");
  });

  it("refuses a document with no version", () => {
    expect(() => setJsonVersion('{"name":"app"}', "1.0.0")).toThrow();
  });
});
