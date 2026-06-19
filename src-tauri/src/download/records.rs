//! Client-local install records. Tracks, per game, whether it is installed,
//! which version, and where it lives on disk. These live in a **separate**
//! per-user file (`install_records.json`), never in the user's `library.json` —
//! the catalog is read-only source of truth, and rewriting it is the one thing
//! we never do. The download engine updates a record as an install progresses
//! (T4c-2); the catalog UI reads the record to show install state without
//! touching the catalog file.
//!
//! The model and collection operations here are pure (no IO); the small
//! load/save pair at the bottom is the only disk seam and uses the same
//! atomic temp-file+rename write the settings store uses, so a crash mid-write
//! can never corrupt the records.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Where a game stands from the launcher's point of view. Maps onto the
/// `installState` strings the C++ catalog uses (`notInstalled` / `installed` /
/// `updateAvailable`) plus the in-flight states the queue needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum InstallState {
    /// No local install on record.
    #[default]
    NotInstalled,
    /// An install is in progress (downloading / verifying / extracting).
    Installing,
    /// Fully installed and launchable.
    Installed,
    /// Installed, but the catalog advertises a newer version.
    UpdateAvailable,
    /// Install was paused by the user; `.part` files are retained.
    Paused,
    /// Install stopped with an error and can be retried.
    Failed,
}

impl InstallState {
    /// The `installState` string the catalog model uses, so the UI can render a
    /// record and a catalog entry uniformly.
    pub fn as_catalog_str(self) -> &'static str {
        match self {
            InstallState::NotInstalled => "notInstalled",
            InstallState::Installing => "installing",
            InstallState::Installed => "installed",
            InstallState::UpdateAvailable => "updateAvailable",
            InstallState::Paused => "paused",
            InstallState::Failed => "failed",
        }
    }
}

/// One game's install record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallRecord {
    pub game_id: String,
    pub state: InstallState,
    /// Installed content version (manifest/catalog version), for update checks.
    pub version: String,
    /// Absolute install directory the files were written to.
    pub install_dir: String,
    /// Total installed size in bytes (manifest total).
    pub total_bytes: u64,
    /// Unix seconds of the last state change. 0 if never set.
    pub updated_at: i64,
}

/// The full set of install records, keyed by game id. `BTreeMap` keeps the
/// on-disk file in a stable, diff-friendly order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallRecords {
    pub records: BTreeMap<String, InstallRecord>,
}

impl InstallRecords {
    /// The record for `game_id`, if any.
    pub fn get(&self, game_id: &str) -> Option<&InstallRecord> {
        self.records.get(game_id)
    }

    /// The state of `game_id`, defaulting to `NotInstalled` when unrecorded.
    pub fn state_of(&self, game_id: &str) -> InstallState {
        self.records.get(game_id).map(|r| r.state).unwrap_or_default()
    }

    /// Insert or replace a record (keyed by its `game_id`).
    pub fn upsert(&mut self, record: InstallRecord) {
        self.records.insert(record.game_id.clone(), record);
    }

    /// Transition `game_id` to `state`, stamping `now`. Creates a bare record if
    /// none exists yet (so a fresh install can record `Installing` immediately).
    pub fn set_state(&mut self, game_id: &str, state: InstallState, now: i64) {
        let rec = self.records.entry(game_id.to_string()).or_insert_with(|| InstallRecord {
            game_id: game_id.to_string(),
            ..Default::default()
        });
        rec.state = state;
        rec.updated_at = now;
    }

    /// Drop a record (e.g. after an uninstall). Returns whether one was present.
    pub fn remove(&mut self, game_id: &str) -> bool {
        self.records.remove(game_id).is_some()
    }

    /// A `game_id → catalog state string` map of every recorded game, for the
    /// catalog UI to overlay onto the read-only library without a reload. Uses
    /// the same `installState` strings the catalog model speaks.
    pub fn state_map(&self) -> BTreeMap<String, String> {
        self.records
            .values()
            .map(|r| (r.game_id.clone(), r.state.as_catalog_str().to_string()))
            .collect()
    }

    /// Apply a `game_id → server content version` map to the installed records,
    /// flipping `Installed` → `UpdateAvailable` where the server advertises a
    /// different, non-empty version (and back to `Installed` if a previously
    /// flagged game is now current again — e.g. after the user updated). Only
    /// on-disk records are considered; in-flight/failed ones are left alone.
    /// Returns the ids whose state changed, so the caller can log/notify.
    pub fn mark_updates(&mut self, server_versions: &BTreeMap<String, String>) -> Vec<String> {
        let mut changed = Vec::new();
        for rec in self.records.values_mut() {
            let server = match server_versions.get(&rec.game_id) {
                Some(v) => v,
                None => continue,
            };
            let want = if update_available(&rec.version, server) {
                InstallState::UpdateAvailable
            } else {
                InstallState::Installed
            };
            // Only nudge between the two on-disk states; never resurrect a
            // Failed/Installing/NotInstalled record from a version check.
            let is_on_disk = matches!(rec.state, InstallState::Installed | InstallState::UpdateAvailable);
            if is_on_disk && rec.state != want {
                rec.state = want;
                changed.push(rec.game_id.clone());
            }
        }
        changed
    }

    /// Ids that are fully installed (or have an update available — still on disk).
    pub fn installed_ids(&self) -> Vec<&str> {
        self.records
            .values()
            .filter(|r| matches!(r.state, InstallState::Installed | InstallState::UpdateAvailable))
            .map(|r| r.game_id.as_str())
            .collect()
    }
}

/// Whether the server advertises a newer build than what's installed. An update
/// is available only when the server version is non-empty and differs from the
/// installed one — an empty/unknown server version never nags (we don't flag an
/// update we can't substantiate). Versions are compared as opaque trimmed
/// strings, mirroring the C++ client's `version != installedVersion` check.
pub fn update_available(installed_version: &str, server_version: &str) -> bool {
    let server = server_version.trim();
    !server.is_empty() && server != installed_version.trim()
}

/// Load records from `path`. A missing or empty file yields an empty set, so a
/// first run (no installs yet) is not an error.
pub fn load(path: &Path) -> AppResult<InstallRecords> {
    if !path.exists() {
        return Ok(InstallRecords::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(InstallRecords::default());
    }
    Ok(serde_json::from_str::<InstallRecords>(&text)?)
}

/// Save records to `path` atomically (temp file + rename), creating the parent
/// directory if needed.
pub fn save(path: &Path, records: &InstallRecords) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(records)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_records_test_{}_{}.json", std::process::id(), name));
        p
    }

    fn record(id: &str, state: InstallState) -> InstallRecord {
        InstallRecord { game_id: id.into(), state, ..Default::default() }
    }

    #[test]
    fn state_of_defaults_to_not_installed() {
        let r = InstallRecords::default();
        assert_eq!(r.state_of("missing"), InstallState::NotInstalled);
    }

    #[test]
    fn upsert_set_state_and_remove() {
        let mut r = InstallRecords::default();
        // set_state creates a record on first call.
        r.set_state("zelda", InstallState::Installing, 100);
        assert_eq!(r.state_of("zelda"), InstallState::Installing);
        assert_eq!(r.get("zelda").unwrap().updated_at, 100);
        // …and updates it on the next.
        r.set_state("zelda", InstallState::Installed, 200);
        assert_eq!(r.state_of("zelda"), InstallState::Installed);
        assert_eq!(r.get("zelda").unwrap().updated_at, 200);
        // upsert replaces wholesale.
        r.upsert(InstallRecord { game_id: "zelda".into(), version: "2.0".into(), ..record("zelda", InstallState::UpdateAvailable) });
        assert_eq!(r.get("zelda").unwrap().version, "2.0");
        assert!(r.remove("zelda"));
        assert!(!r.remove("zelda"));
        assert_eq!(r.state_of("zelda"), InstallState::NotInstalled);
    }

    #[test]
    fn installed_ids_filters_to_on_disk() {
        let mut r = InstallRecords::default();
        r.upsert(record("a", InstallState::Installed));
        r.upsert(record("b", InstallState::UpdateAvailable));
        r.upsert(record("c", InstallState::Installing));
        r.upsert(record("d", InstallState::Failed));
        let mut ids = r.installed_ids();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn state_map_uses_catalog_strings() {
        let mut r = InstallRecords::default();
        r.upsert(record("a", InstallState::Installed));
        r.upsert(record("b", InstallState::Installing));
        r.upsert(record("c", InstallState::Failed));
        let m = r.state_map();
        assert_eq!(m.get("a").map(String::as_str), Some("installed"));
        assert_eq!(m.get("b").map(String::as_str), Some("installing"));
        assert_eq!(m.get("c").map(String::as_str), Some("failed"));
        assert_eq!(m.len(), 3);
    }

    #[test]
    fn update_available_compares_trimmed_nonempty() {
        assert!(update_available("1.0", "1.1"));
        assert!(!update_available("1.0", "1.0"));
        assert!(!update_available("1.0", "  1.0 ")); // trimmed equal
        assert!(update_available("1.0", " 1.2 "));
        // Empty/unknown server version never flags an update.
        assert!(!update_available("1.0", ""));
        assert!(!update_available("1.0", "   "));
        // An installed game with no recorded version updates to any real version.
        assert!(update_available("", "1.0"));
    }

    #[test]
    fn mark_updates_flips_on_disk_states_only() {
        let mut r = InstallRecords::default();
        r.upsert(InstallRecord { game_id: "a".into(), state: InstallState::Installed, version: "1.0".into(), ..Default::default() });
        r.upsert(InstallRecord { game_id: "b".into(), state: InstallState::Installed, version: "2.0".into(), ..Default::default() });
        r.upsert(InstallRecord { game_id: "c".into(), state: InstallState::UpdateAvailable, version: "3.0".into(), ..Default::default() });
        r.upsert(InstallRecord { game_id: "d".into(), state: InstallState::Failed, version: "1.0".into(), ..Default::default() });

        let mut versions = BTreeMap::new();
        versions.insert("a".to_string(), "1.1".to_string()); // newer → flag
        versions.insert("b".to_string(), "2.0".to_string()); // same → stays Installed
        versions.insert("c".to_string(), "3.0".to_string()); // now current → clear flag
        versions.insert("d".to_string(), "9.9".to_string()); // Failed → untouched
        let mut changed = r.mark_updates(&versions);
        changed.sort();

        assert_eq!(changed, vec!["a", "c"]);
        assert_eq!(r.state_of("a"), InstallState::UpdateAvailable);
        assert_eq!(r.state_of("b"), InstallState::Installed);
        assert_eq!(r.state_of("c"), InstallState::Installed);
        assert_eq!(r.state_of("d"), InstallState::Failed);
        // A second pass with the same versions is a no-op (idempotent).
        assert!(r.mark_updates(&versions).is_empty());
    }

    #[test]
    fn missing_file_is_empty() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), InstallRecords::default());
    }

    #[test]
    fn round_trip_preserves_records() {
        let p = tmp_path("roundtrip");
        let mut r = InstallRecords::default();
        r.upsert(InstallRecord {
            game_id: "zelda".into(),
            state: InstallState::Installed,
            version: "1.3".into(),
            install_dir: "/games/zelda".into(),
            total_bytes: 4096,
            updated_at: 1700,
        });
        save(&p, &r).unwrap();
        assert_eq!(load(&p).unwrap(), r);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tolerates_partial_and_unknown_fields() {
        let p = tmp_path("partial");
        // A record missing most fields plus an unknown top-level key.
        std::fs::write(&p, r#"{"records":{"x":{"gameId":"x","state":"installed"}},"extra":1}"#).unwrap();
        let loaded = load(&p).unwrap();
        assert_eq!(loaded.state_of("x"), InstallState::Installed);
        assert_eq!(loaded.get("x").unwrap().total_bytes, 0);
        let _ = std::fs::remove_file(&p);
    }
}
