//! Unpack a staged emulator runtime archive into a runnable directory.
//!
//! Emulators arrive as a single archive (`.zip` for Ryujinx/Xenia/xemu/Mesen/
//! DuckStation, `.7z` for Dolphin/RPCS3/PCSX2) or as a loose `.exe`/firmware
//! blob that needs no unpacking. After staging, the archive is expanded into a
//! per-emulator runtime dir so the launch layer can find the emulator's `.exe`.
//! Both formats are run through the same zip-slip guard the download path uses
//! (`resolve_target`), so an archive entry can never escape the runtime dir.

use crate::download::extract::extract_zip;
use crate::download::paths::resolve_target;
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::Path;

/// True if `name` looks like an archive we know how to expand.
pub fn is_archive(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.ends_with(".zip") || l.ends_with(".7z")
}

/// Expand the archive at `archive` into `dest` (created if missing). Dispatches
/// on extension. Returns the number of files written.
pub fn unpack_archive(archive: &Path, dest: &Path) -> AppResult<u32> {
    let name = archive
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    fs::create_dir_all(dest).map_err(|e| AppError::msg(format!("mkdir runtime dir failed: {e}")))?;
    if name.ends_with(".zip") {
        extract_zip(archive, dest)
    } else if name.ends_with(".7z") {
        extract_7z(archive, dest)
    } else {
        Err(AppError::msg(format!("unsupported archive: {name}")))
    }
}

/// Extract a `.7z` into `dest`, rejecting any entry whose path escapes `dest`.
/// The decode is pure-Rust (LZMA/LZMA2); the path-safety decision mirrors the
/// zip extractor exactly so the two formats can never be exploited differently.
fn extract_7z(archive: &Path, dest: &Path) -> AppResult<u32> {
    let file =
        fs::File::open(archive).map_err(|e| AppError::msg(format!("open 7z failed: {e}")))?;
    let len = file
        .metadata()
        .map_err(|e| AppError::msg(format!("stat 7z failed: {e}")))?
        .len();
    let mut reader = sevenz_rust::SevenZReader::new(file, len, sevenz_rust::Password::empty())
        .map_err(|e| AppError::msg(format!("not a valid 7z: {e}")))?;

    let mut written = 0u32;
    reader
        .for_each_entries(|entry, rd| {
            // Directory entries: create the validated dir and continue.
            if entry.is_directory() {
                if let Some(dir) = resolve_target(dest, entry.name()) {
                    fs::create_dir_all(&dir).ok();
                }
                return Ok(true);
            }
            let Some(target) = resolve_target(dest, entry.name()) else {
                // Reject the whole extraction on an unsafe (zip-slip) entry.
                return Err(sevenz_rust::Error::other(format!(
                    "unsafe archive entry: {}",
                    entry.name()
                )));
            };
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out = fs::File::create(&target)
                .map_err(|e| sevenz_rust::Error::other(format!("write extracted file: {e}")))?;
            std::io::copy(rd, &mut out)
                .map_err(|e| sevenz_rust::Error::other(format!("extract copy: {e}")))?;
            written += 1;
            Ok(true)
        })
        .map_err(|e| AppError::msg(format!("7z extract failed: {e}")))?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_archives() {
        assert!(is_archive("dolphin-x64.7z"));
        assert!(is_archive("ryujinx-win-x64.zip"));
        assert!(is_archive("MESEN-WINDOWS.ZIP"));
        assert!(!is_archive("gopher64-windows-x86_64.exe"));
        assert!(!is_archive("scph1001.bin"));
        assert!(!is_archive("PS3UPDAT.PUP"));
    }
}
