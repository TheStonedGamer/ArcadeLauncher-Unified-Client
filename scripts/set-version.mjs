// Stamp a release tag into every file that carries the desktop app version.
//
// The git tag is the single source of truth for what a release *is*. Android
// already derived its version from the tag; the desktop legs did not, so tagging
// v0.15.29 while the committed files still said 0.15.28 produced installers
// named 0.15.28 and a `latest.json` announcing 0.15.28 — an update that existing
// clients correctly refused to install, because it was not a newer version.
//
// Run from the repo root: `node scripts/set-version.mjs v1.2.3`.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Parse `v1.2.3` (or `1.2.3`) into a version string, or throw. */
export function versionFromTag(tag) {
  const version = String(tag ?? "").trim().replace(/^v/, "");
  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`Release tag must be vMAJOR.MINOR.PATCH, got "${tag}"`);
  }
  for (const part of parts) {
    // Reject "01" and "1.2.3-rc1" as well as non-numbers: these strings end up
    // in installer filenames and an updater comparison, so they must be exact.
    if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) > 999) {
      throw new Error(`Release tag must be vMAJOR.MINOR.PATCH, got "${tag}"`);
    }
  }
  return version;
}

/** Replace only the `[package]` version in a Cargo manifest. */
export function setCargoVersion(text, version) {
  const idx = text.indexOf("[package]");
  if (idx === -1) throw new Error("Cargo.toml has no [package] section");
  const head = text.slice(0, idx);
  const rest = text.slice(idx);
  // Bounded to the first version key after [package] so dependency versions,
  // which look identical, are never touched.
  const key = /^version\s*=\s*"[^"]*"/m;
  // Test for the key rather than comparing before/after: when the committed
  // version already equals the tag the rewrite is a legitimate no-op, and
  // treating that as "no version key" fails every release where the two agree.
  if (!key.test(rest)) throw new Error("Cargo.toml [package] has no version key");
  return head + rest.replace(key, `version = "${version}"`);
}

/** Replace the top-level `"version"` of a JSON document.
 *
 * Edits the text rather than round-tripping through JSON.stringify, which would
 * reflow every inline array in tauri.conf.json and bury a one-line change in
 * unrelated churn. The result is parsed back to prove the edit landed on the
 * top-level key and nowhere else. */
export function setJsonVersion(text, version) {
  const before = JSON.parse(text);
  if (typeof before.version !== "string") throw new Error("JSON has no top-level version");
  // Top-level keys are at exactly one indent level; a nested "version" (a
  // dependency, say) is deeper and cannot match.
  const out = text.replace(/^(\s\s"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);
  const after = JSON.parse(out);
  if (after.version !== version) throw new Error("Could not rewrite the top-level version");
  return out;
}

function main() {
  const version = versionFromTag(process.argv[2]);
  for (const path of ["package.json", "src-tauri/tauri.conf.json"]) {
    writeFileSync(path, setJsonVersion(readFileSync(path, "utf8"), version));
  }
  const cargo = "src-tauri/Cargo.toml";
  writeFileSync(cargo, setCargoVersion(readFileSync(cargo, "utf8"), version));
  console.log(`Desktop version set to ${version}`);
}

// Only act when run as a script, so the parsing rules stay unit-testable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
