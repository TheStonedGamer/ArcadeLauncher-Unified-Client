//! Disk persistence for General settings: non-destructive load (missing file →
//! defaults; partial file → defaults fill the gaps) and atomic save (write to a
//! temp file, then rename) so a crash mid-write never corrupts the config.

use crate::error::AppResult;
use crate::settings::model::General;
use std::path::Path;

/// Load settings from `path`. Missing file yields defaults.
pub fn load(path: &Path) -> AppResult<General> {
    if !path.exists() {
        return Ok(General::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(General::default());
    }
    Ok(serde_json::from_str::<General>(&text)?)
}

/// Save settings to `path` atomically (temp file + rename). Creates the parent
/// directory if needed.
pub fn save(path: &Path, settings: &General) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings)?;
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
        p.push(format!("ualc_settings_test_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn missing_file_is_defaults() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), General::default());
    }

    #[test]
    fn round_trip_preserves_values() {
        let p = tmp_path("roundtrip");
        let mut s = General::default();
        s.library_path = "/games/library.json".into();
        s.download_limit_kbps = 2048;
        s.close_to_tray = false;
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap(), s);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn partial_file_fills_defaults() {
        let p = tmp_path("partial");
        std::fs::write(&p, r#"{"libraryPath":"/x.json","downloadLimitKbps":500}"#).unwrap();
        let loaded = load(&p).unwrap();
        assert_eq!(loaded.library_path, "/x.json");
        assert_eq!(loaded.download_limit_kbps, 500);
        // Untouched fields keep their defaults.
        assert_eq!(loaded.concurrent_downloads, General::default().concurrent_downloads);
        assert_eq!(loaded.theme, "dark");
        let _ = std::fs::remove_file(&p);
    }
}
