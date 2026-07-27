//! Local save-folder scan. Walks a per-game save directory and produces the
//! same `SaveFile { path, mtime, size }` list the server reports, so the pure
//! `sync::plan_sync` can diff the two sides. This is the disk seam for cloud
//! saves; the path→wire-path conversion and validation it relies on are pure
//! and tested in `paths`.

use crate::saves::paths::to_rel_save_path;
use crate::saves::sync::SaveFile;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Recursively scan `base` into a list of `SaveFile`s with server-relative
/// paths. A missing directory yields an empty list (nothing synced yet is not
/// an error). Files whose path can't be expressed as a valid save path are
/// skipped rather than failing the whole scan.
pub fn scan_save_dir(base: &Path) -> std::io::Result<Vec<SaveFile>> {
    let mut out = Vec::new();
    if !base.exists() {
        return Ok(out);
    }
    walk(base, base, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Scan a single file under `base` — the save location the user picked is a
/// file, not a directory. Walking the whole parent would be wrong (it may be an
/// emulator config folder holding megabytes we must never sync) and slow, so we
/// stat just this one entry. A missing file yields an empty list, exactly as a
/// missing directory does.
pub fn scan_save_file(base: &Path, name: &str) -> std::io::Result<Vec<SaveFile>> {
    let path = base.join(name);
    let Ok(meta) = std::fs::metadata(&path) else { return Ok(Vec::new()) };
    if !meta.is_file() {
        return Ok(Vec::new());
    }
    Ok(entry_of(base, &path, &meta).into_iter().collect())
}

/// Describe one file relative to `base`, or `None` if its path isn't expressible
/// as a save path.
fn entry_of(base: &Path, path: &Path, meta: &std::fs::Metadata) -> Option<SaveFile> {
    let rel = to_rel_save_path(base, path)?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Some(SaveFile { path: rel, mtime, size: meta.len() })
}

fn walk(base: &Path, dir: &Path, out: &mut Vec<SaveFile>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        if meta.is_dir() {
            walk(base, &path, out)?;
        } else if meta.is_file() {
            out.extend(entry_of(base, &path, &meta));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_saves_scan_{}_{}", std::process::id(), name));
        p
    }

    #[test]
    fn missing_dir_is_empty() {
        let d = tmp_dir("missing");
        let _ = std::fs::remove_dir_all(&d);
        assert!(scan_save_dir(&d).unwrap().is_empty());
    }

    #[test]
    fn scans_nested_files_with_relative_paths() {
        let d = tmp_dir("nested");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("slot1")).unwrap();
        std::fs::write(d.join("top.sav"), b"abc").unwrap();
        std::fs::write(d.join("slot1").join("player.sav"), b"hello").unwrap();

        let files = scan_save_dir(&d).unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["slot1/player.sav", "top.sav"]);
        // Sizes reflect the bytes written.
        let by = |p: &str| files.iter().find(|f| f.path == p).unwrap().size;
        assert_eq!(by("top.sav"), 3);
        assert_eq!(by("slot1/player.sav"), 5);

        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn single_file_scope_sees_only_that_file() {
        let d = tmp_dir("onefile");
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("memcard.mcd"), b"save").unwrap();
        std::fs::write(d.join("unrelated.log"), b"noise").unwrap();

        let files = scan_save_file(&d, "memcard.mcd").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "memcard.mcd");
        assert_eq!(files[0].size, 4);

        // Absent and non-file targets are empty, never an error.
        assert!(scan_save_file(&d, "nope.mcd").unwrap().is_empty());
        std::fs::create_dir_all(d.join("adir")).unwrap();
        assert!(scan_save_file(&d, "adir").unwrap().is_empty());

        let _ = std::fs::remove_dir_all(&d);
    }
}
