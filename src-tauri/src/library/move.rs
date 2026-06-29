//! Relocating an installed game's folder from one library (drive) to another.
//! Same-volume moves are an instant `fs::rename`; cross-volume moves (the common
//! case for "move to another drive", where `rename` fails with a cross-device
//! error) fall back to a streaming copy that reports progress and rolls back on
//! any failure, so the original install is never left half-deleted.
//!
//! This is the IO core, kept free of Tauri/event types so it can be unit-tested
//! against a temp tree; the command layer wires `on_progress` to the
//! `library://move-progress` event.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Recursively sum the byte size of every regular file under `path`. Best-effort:
/// entries that can't be stat'd are skipped. Used as the progress-bar total when
/// the install record has no recorded `total_bytes`.
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => total += dir_size(&p),
            Ok(ft) if ft.is_file() => {
                if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
            _ => {}
        }
    }
    total
}

/// True if `e` is a cross-device link error (EXDEV on Unix = 18,
/// ERROR_NOT_SAME_DEVICE on Windows = 17) — i.e. a `rename` across volumes that
/// must instead be done as copy-then-delete.
fn is_cross_device(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(17) | Some(18))
}

/// Move the install tree at `src` to `dst`. Tries an atomic same-volume rename
/// first; on a cross-device error it copies then deletes (see [`move_by_copy`]).
/// `total` is the expected byte count for the progress bar; `on_progress` is
/// called with the running copied-byte count (only during the copy path — a
/// rename is instant and reports `total` once at the end).
pub fn move_tree(
    src: &Path,
    dst: &Path,
    total: u64,
    mut on_progress: impl FnMut(u64),
) -> io::Result<()> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(src, dst) {
        Ok(()) => {
            on_progress(total);
            Ok(())
        }
        Err(e) if is_cross_device(&e) => move_by_copy(src, dst, &mut on_progress),
        Err(e) => Err(e),
    }
}

/// Cross-volume move: copy `src` into a staging sibling of `dst`, swap it into
/// place, then delete `src`. Any failure during the copy rolls back the partial
/// staging copy and leaves `src` untouched. Exposed (crate-internal) so tests can
/// exercise the copy path without a second physical volume.
pub fn move_by_copy(
    src: &Path,
    dst: &Path,
    on_progress: &mut impl FnMut(u64),
) -> io::Result<()> {
    let staging = staging_path(dst);
    let _ = fs::remove_dir_all(&staging); // clear any leftover from a prior abort
    let mut copied = 0u64;
    if let Err(e) = copy_dir(src, &staging, &mut copied, on_progress) {
        let _ = fs::remove_dir_all(&staging); // rollback partial copy
        return Err(e);
    }
    // Copy is complete in staging; swap it into the final destination.
    if let Err(e) = fs::rename(&staging, dst) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    // Only now remove the original — the copy is safely in place.
    fs::remove_dir_all(src)
}

/// A staging path sibling to `dst` (`<name>.moving.part`), so the copy lands on
/// the *target* volume before the atomic swap.
fn staging_path(dst: &Path) -> PathBuf {
    let name = dst
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "install".to_string());
    dst.with_file_name(format!("{name}.moving.part"))
}

/// Recursively copy `src` into `dst`, streaming `on_progress` with the running
/// total of copied bytes after each file.
fn copy_dir(
    src: &Path,
    dst: &Path,
    copied: &mut u64,
    on_progress: &mut impl FnMut(u64),
) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to, copied, on_progress)?;
        } else {
            let n = fs::copy(&from, &to)?;
            *copied += n;
            on_progress(*copied);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_move_{}_{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn seed_tree(root: &Path) -> u64 {
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("game.exe"), b"hello world").unwrap(); // 11 bytes
        fs::write(root.join("sub/data.bin"), b"abcd").unwrap(); // 4 bytes
        15
    }

    #[test]
    fn dir_size_sums_files_recursively() {
        let root = temp_root("size");
        let total = seed_tree(&root);
        assert_eq!(dir_size(&root), total);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_tree_same_volume_renames_and_reports_total() {
        let root = temp_root("rename");
        let src = root.join("src");
        let dst = root.join("dst");
        let total = seed_tree(&src);

        let mut last = 0u64;
        move_tree(&src, &dst, total, |c| last = c).unwrap();

        assert!(!src.exists(), "src removed after move");
        assert!(dst.join("game.exe").exists());
        assert!(dst.join("sub/data.bin").exists());
        assert_eq!(last, total, "progress reported the total");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_by_copy_moves_tree_and_reports_monotonic_progress() {
        let root = temp_root("copy");
        let src = root.join("src");
        let dst = root.join("dst");
        let total = seed_tree(&src);

        let mut samples = Vec::new();
        move_by_copy(&src, &dst, &mut |c| samples.push(c)).unwrap();

        assert!(!src.exists(), "src removed after copy-move");
        assert!(dst.join("game.exe").exists());
        assert!(dst.join("sub/data.bin").exists());
        assert!(!samples.is_empty());
        // Monotonic non-decreasing and ends at the full size.
        assert!(samples.windows(2).all(|w| w[0] <= w[1]));
        assert_eq!(*samples.last().unwrap(), total);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_by_copy_rolls_back_and_keeps_src_on_failure() {
        let root = temp_root("rollback");
        let src = root.join("src");
        let dst = root.join("dst");
        seed_tree(&src);

        // Block the staging path with a *file* so `create_dir_all(staging)` fails.
        let staging = staging_path(&dst);
        if let Some(parent) = staging.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&staging, b"blocker").unwrap();

        let err = move_by_copy(&src, &dst, &mut |_| {});
        assert!(err.is_err(), "copy should fail when staging is blocked");
        // Source untouched; destination never created.
        assert!(src.join("game.exe").exists(), "src preserved on failure");
        assert!(!dst.exists(), "dst not created on failure");
        let _ = fs::remove_dir_all(&root);
    }
}
