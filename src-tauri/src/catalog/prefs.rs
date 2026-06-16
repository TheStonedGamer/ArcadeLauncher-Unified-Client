//! Client-local catalog preferences: the user's favorite / hidden overrides and
//! per-game collection membership. These live in a **separate** per-user file
//! (`catalog_prefs.json`) and are overlaid onto the catalog at display time, so
//! the user's `library.json` is never rewritten — the same non-destructive
//! contract the install records keep.
//!
//! The overrides are stored sparsely: only games the user has actually toggled
//! appear here. A game absent from `favorites`/`hidden` keeps whatever its
//! `library.json` entry said; a game absent from `collections` keeps its catalog
//! collections. The merge itself is done in the (unit-tested) TS overlay; this
//! module owns just the serde model and the atomic, non-destructive disk store.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Sparse per-game overrides. `BTreeMap` keeps the file stable and diff-friendly.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CatalogPrefs {
    /// game id → favorite override (present only when toggled).
    pub favorites: BTreeMap<String, bool>,
    /// game id → hidden override (present only when toggled).
    pub hidden: BTreeMap<String, bool>,
    /// game id → full replacement collection list (present only when edited).
    pub collections: BTreeMap<String, Vec<String>>,
    /// game id → absolute local save folder for cloud-save sync (present only
    /// when the user has pointed this game at a real save directory). Empty /
    /// absent means the managed `app_data/saves/<id>` folder is used.
    pub save_paths: BTreeMap<String, String>,
}

/// Load prefs from `path`. A missing or empty file yields empty prefs, so a
/// first run (nothing toggled yet) is not an error.
pub fn load(path: &Path) -> AppResult<CatalogPrefs> {
    if !path.exists() {
        return Ok(CatalogPrefs::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(CatalogPrefs::default());
    }
    Ok(serde_json::from_str::<CatalogPrefs>(&text)?)
}

/// Save prefs to `path` atomically (temp file + rename), creating the parent
/// directory if needed.
pub fn save(path: &Path, prefs: &CatalogPrefs) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(prefs)?;
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
        p.push(format!("ualc_prefs_test_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn missing_file_is_empty() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), CatalogPrefs::default());
    }

    #[test]
    fn round_trip_preserves_overrides() {
        let p = tmp_path("roundtrip");
        let mut prefs = CatalogPrefs::default();
        prefs.favorites.insert("zelda".into(), true);
        prefs.hidden.insert("e.t.".into(), true);
        prefs.collections.insert("zelda".into(), vec!["Favorites".into(), "RPGs".into()]);
        prefs.save_paths.insert("zelda".into(), "/home/u/saves/zelda".into());
        save(&p, &prefs).unwrap();
        assert_eq!(load(&p).unwrap(), prefs);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tolerates_partial_and_unknown_fields() {
        let p = tmp_path("partial");
        // Only favorites present, plus an unknown top-level key.
        std::fs::write(&p, r#"{"favorites":{"a":true},"extra":9}"#).unwrap();
        let loaded = load(&p).unwrap();
        assert_eq!(loaded.favorites.get("a"), Some(&true));
        assert!(loaded.hidden.is_empty());
        assert!(loaded.collections.is_empty());
        let _ = std::fs::remove_file(&p);
    }
}
