//! Safe archive extraction for `pc_archive` installs. After the download phase
//! has written and SHA-256-verified the archive, the install is unpacked into
//! the game's install directory. Every entry's path is run through the same
//! [`resolve_target`] guard the download phase uses, so a malicious zip can
//! never write outside the install dir — the classic "zip-slip" attack
//! (`../../etc/...`) is rejected before any bytes are written. The unzip itself
//! is glue; the path-safety decision is the part worth testing.

use crate::download::paths::resolve_target;
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::Path;

/// Extract the zip at `archive` into `install_dir`, returning the number of
/// files written. Errors (rejecting the whole extraction) if any entry's path
/// escapes `install_dir`.
pub fn extract_zip(archive: &Path, install_dir: &Path) -> AppResult<u32> {
    let file = fs::File::open(archive)
        .map_err(|e| AppError::msg(format!("open archive failed: {e}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::msg(format!("not a valid zip: {e}")))?;

    let mut written = 0u32;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::msg(format!("corrupt zip entry: {e}")))?;
        let name = entry.name().to_string();

        // Directory entries: create the (validated) directory and move on.
        if entry.is_dir() {
            if let Some(dir) = resolve_target(install_dir, &name) {
                fs::create_dir_all(&dir)?;
            }
            continue;
        }

        let target = resolve_target(install_dir, &name)
            .ok_or_else(|| AppError::msg(format!("unsafe archive entry: {name}")))?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&target)
            .map_err(|e| AppError::msg(format!("write extracted file failed: {e}")))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| AppError::msg(format!("extract copy failed: {e}")))?;
        written += 1;
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn tmp_dir(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_extract_test_{}_{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Build a zip at `path` from `(name, contents)` pairs (a trailing `/` name
    /// is a directory entry).
    fn build_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default();
        for (name, data) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, opts).unwrap();
            } else {
                zip.start_file(*name, opts).unwrap();
                zip.write_all(data).unwrap();
            }
        }
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_files_and_nested_dirs() {
        let dir = tmp_dir("ok");
        let archive = dir.join("game.zip");
        let dest = dir.join("install");
        build_zip(
            &archive,
            &[("game.exe", b"MZ"), ("data/", b""), ("data/a.pak", b"PACK")],
        );

        let count = extract_zip(&archive, &dest).unwrap();
        assert_eq!(count, 2); // two files (the dir entry isn't counted)
        assert_eq!(fs::read(dest.join("game.exe")).unwrap(), b"MZ");
        assert_eq!(fs::read(dest.join("data/a.pak")).unwrap(), b"PACK");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_zip_slip_entry() {
        let dir = tmp_dir("slip");
        let archive = dir.join("evil.zip");
        let dest = dir.join("install");
        build_zip(&archive, &[("../escape.txt", b"pwned")]);

        let err = extract_zip(&archive, &dest).unwrap_err();
        assert!(err.to_string().contains("unsafe archive entry"));
        // Nothing escaped above the install dir.
        assert!(!dir.join("escape.txt").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn errors_on_non_zip() {
        let dir = tmp_dir("notzip");
        let archive = dir.join("plain.bin");
        fs::write(&archive, b"not a zip at all").unwrap();
        assert!(extract_zip(&archive, &dir.join("install")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
