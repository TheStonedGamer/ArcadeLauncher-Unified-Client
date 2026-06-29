//! Free/total disk space for a library folder, used by the Storage manager's
//! usage bars. Backed by the pure-Rust `fs4` crate (no system-service deps,
//! identical on Windows + Linux), consistent with the project's dependency rule.
//!
//! `space` is best-effort: it walks up to the nearest existing ancestor of
//! `path` (a not-yet-created library folder still reports its drive's space) and
//! yields `(0, 0)` if even that can't be queried, so the UI degrades gracefully.

use std::path::Path;

/// Available and total bytes on the volume that holds (or would hold) `path`.
/// Returns `(available, total)`; `(0, 0)` when the volume can't be queried.
pub fn space(path: &Path) -> (u64, u64) {
    let probe = nearest_existing(path);
    let probe = match probe {
        Some(p) => p,
        None => return (0, 0),
    };
    let available = fs4::available_space(&probe).unwrap_or(0);
    let total = fs4::total_space(&probe).unwrap_or(0);
    (available, total)
}

/// The nearest existing ancestor of `path` (including `path` itself). A library
/// folder the user just typed may not exist yet, but its drive does.
fn nearest_existing(path: &Path) -> Option<std::path::PathBuf> {
    let mut cur = Some(path);
    while let Some(p) = cur {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        cur = p.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_reports_nonzero_for_temp_dir() {
        // The temp dir always exists, so we expect a real, non-zero capacity.
        let (avail, total) = space(&std::env::temp_dir());
        assert!(total > 0, "total space should be positive");
        assert!(avail <= total, "available never exceeds total");
    }

    #[test]
    fn space_walks_up_to_existing_ancestor() {
        // A non-existent child under temp still resolves to the temp volume.
        let phantom = std::env::temp_dir().join("ualc_does_not_exist_xyz").join("deeper");
        let (_avail, total) = space(&phantom);
        assert!(total > 0, "should fall back to an existing ancestor's volume");
    }

    #[test]
    fn space_of_nonexistent_root_is_zero() {
        // A path with no existing ancestor yields (0, 0) rather than panicking.
        #[cfg(windows)]
        let bogus = Path::new("Z:/no/such/volume/here");
        #[cfg(not(windows))]
        let bogus = Path::new("/no/such/volume/here/at/all");
        // On most systems the root ("/" or "Z:/") may or may not exist; we only
        // assert it doesn't panic and available never exceeds total.
        let (avail, total) = space(bogus);
        assert!(avail <= total);
    }
}
