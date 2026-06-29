//! Disk persistence for the library-folders list: non-destructive load (missing
//! file → empty set; partial file → defaults fill the gaps) and atomic save
//! (temp file + rename), mirroring `settings/store.rs` and `download/records.rs`
//! so a crash mid-write can never corrupt `library_folders.json`.

use crate::error::AppResult;
use crate::library::model::LibraryFolders;
use std::path::Path;

/// Load the library folders from `path`. Missing or empty file → empty set.
pub fn load(path: &Path) -> AppResult<LibraryFolders> {
    if !path.exists() {
        return Ok(LibraryFolders::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(LibraryFolders::default());
    }
    Ok(serde_json::from_str::<LibraryFolders>(&text)?)
}

/// Save the library folders to `path` atomically (temp file + rename), creating
/// the parent directory if needed.
pub fn save(path: &Path, folders: &LibraryFolders) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(folders)?;
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
        p.push(format!("ualc_library_test_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn missing_file_is_empty() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), LibraryFolders::default());
    }

    #[test]
    fn round_trip_preserves_folders() {
        let p = tmp_path("roundtrip");
        let mut lf = LibraryFolders::default();
        lf.add("D:/Games").unwrap();
        lf.add("E:/Library").unwrap();
        save(&p, &lf).unwrap();
        assert_eq!(load(&p).unwrap(), lf);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tolerates_unknown_fields() {
        let p = tmp_path("partial");
        std::fs::write(
            &p,
            r#"{"folders":[{"path":"D:/Games","isDefault":true}],"extra":1}"#,
        )
        .unwrap();
        let loaded = load(&p).unwrap();
        assert_eq!(loaded.default_path(), Some("D:/Games"));
        let _ = std::fs::remove_file(&p);
    }
}
