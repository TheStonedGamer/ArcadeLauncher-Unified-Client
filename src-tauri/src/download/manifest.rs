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
    /// Content version (recorded for update checks). Empty if the server omits it.
    pub version: String,
    /// Install kind, e.g. `pc_archive` (a single archive to extract) vs a plain
    /// file set. Mirrors the server's `install_type`.
    pub install_type: String,
    pub files: Vec<ManifestFile>,
}

/// Whether `path` is the *primary* archive of a `pc_archive` install — i.e. the
/// file the install should extract. Mirrors the server's `is_pc_primary_archive`
/// exactly so both clients pick the same file: `.zip`/`.7z`/`.rar` (or the first
/// part `*.zip|7z|rar.001`), excluding multi-part `*.partN` continuations (N>1).
fn is_primary_archive(path: &str) -> bool {
    let name_l = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    let ext = name_l.rsplit('.').next().unwrap_or("");
    let is_archive_ext = matches!(ext, "zip" | "7z" | "rar");
    let is_split_first = ext == "001"
        && (name_l.ends_with(".7z.001") || name_l.ends_with(".zip.001") || name_l.ends_with(".rar.001"));
    if !is_archive_ext && !is_split_first {
        return false;
    }
    if let Some(idx) = name_l.find(".part") {
        let digits: String = name_l[idx + 5..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.parse::<u32>().map(|n| n > 1).unwrap_or(false) {
            return false;
        }
    }
    true
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

    /// For a `pc_archive` install, the install-relative path of the archive to
    /// extract after download (fed to `InstallContext.archive`). `None` for
    /// plain file-set installs or when no archive file is present. Note: the
    /// client only extracts `.zip` natively; non-zip archives are detected here
    /// but their extraction step will report a clear failure.
    pub fn archive_path(&self) -> Option<String> {
        if self.install_type != "pc_archive" {
            return None;
        }
        self.files
            .iter()
            .map(|f| f.path.as_str())
            .find(|p| is_primary_archive(p))
            .map(|p| p.to_string())
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

    #[test]
    fn parses_version_and_install_type() {
        let body = r#"{"version":"1.4.0","installType":"pc_archive","files":[]}"#;
        let m = Manifest::parse(body).unwrap();
        assert_eq!(m.version, "1.4.0");
        assert_eq!(m.install_type, "pc_archive");
    }

    #[test]
    fn archive_path_only_for_pc_archive() {
        // Non-archive install kinds never extract.
        let mut m = Manifest::parse(
            r#"{"installType":"emulator","files":[{"path":"rom.zip","size":1}]}"#,
        )
        .unwrap();
        assert_eq!(m.archive_path(), None);

        // pc_archive picks the primary archive among the files.
        m = Manifest::parse(
            r#"{"installType":"pc_archive","files":[
                {"path":"readme.txt","size":1},
                {"path":"Game.zip","size":2}
            ]}"#,
        )
        .unwrap();
        assert_eq!(m.archive_path().as_deref(), Some("Game.zip"));

        // No archive file present -> None (engine places files as-is).
        m = Manifest::parse(
            r#"{"installType":"pc_archive","files":[{"path":"game.exe","size":1}]}"#,
        )
        .unwrap();
        assert_eq!(m.archive_path(), None);
    }

    #[test]
    fn primary_archive_matches_server_rules() {
        assert!(is_primary_archive("Game.zip"));
        assert!(is_primary_archive("sub/dir/Game.7z"));
        assert!(is_primary_archive("Game.rar"));
        assert!(is_primary_archive("Game.7z.001"));
        assert!(is_primary_archive("Game.part1.rar"));
        // Continuations and non-archives are rejected.
        assert!(!is_primary_archive("Game.exe"));
        assert!(!is_primary_archive("Game.7z.002"));
        assert!(!is_primary_archive("Game.part2.rar"));
    }
}
