//! Install manifest model — the server's `/api/.../files` payload that lists the
//! files to fetch for a game install. Field names mirror the C++ client's
//! `ServerFileEntry` (`path`, `url`, `sha256`, `size`) so the same backend
//! serves both clients. The per-chunk fallback the C++ client carries is not
//! modeled here: the primary install path is one resumable ranged GET per file.

use serde::{Deserialize, Serialize};

/// One file to download for an install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestFile {
    /// Install-relative destination path (e.g. `data/textures/0.pak`).
    pub path: String,
    /// Absolute URL for a single ranged GET, or empty if served by id+path.
    pub url: String,
    /// Lowercase hex SHA-256 of the complete file.
    pub sha256: String,
    /// Expected size in bytes.
    pub size: u64,
}

/// The full set of files for one game install.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
    pub files: Vec<ManifestFile>,
}

impl Manifest {
    /// Parse a manifest JSON body. Unknown fields are ignored and missing fields
    /// default, so a newer server can extend the payload without breaking us.
    pub fn parse(body: &str) -> Result<Manifest, serde_json::Error> {
        serde_json::from_str(body)
    }

    /// Total bytes across all files — the denominator for overall progress.
    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Number of files in the install.
    pub fn file_count(&self) -> usize {
        self.files.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_files_and_sums_size() {
        let body = r#"{
            "files": [
                {"path":"game.exe","url":"https://h/f/1/game.exe","sha256":"aa","size":100},
                {"path":"data/a.pak","url":"https://h/f/1/data/a.pak","sha256":"bb","size":250}
            ]
        }"#;
        let m = Manifest::parse(body).unwrap();
        assert_eq!(m.file_count(), 2);
        assert_eq!(m.total_bytes(), 350);
        assert_eq!(m.files[0].path, "game.exe");
        assert_eq!(m.files[1].sha256, "bb");
    }

    #[test]
    fn tolerates_missing_and_unknown_fields() {
        // No url, plus an unknown `chunks` field the C++ client carries.
        let body = r#"{"files":[{"path":"x","size":5,"chunks":[]}]}"#;
        let m = Manifest::parse(body).unwrap();
        assert_eq!(m.files[0].path, "x");
        assert_eq!(m.files[0].url, "");
        assert_eq!(m.total_bytes(), 5);
    }

    #[test]
    fn empty_manifest_is_zero() {
        let m = Manifest::parse(r#"{"files":[]}"#).unwrap();
        assert_eq!(m.file_count(), 0);
        assert_eq!(m.total_bytes(), 0);
    }
}
