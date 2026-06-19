//! Place launcher-staged BIOS/firmware into each emulator's expected directory.
//!
//! The server stages console BIOS blobs into `<app_data>/emulators/` alongside
//! the emulator runtimes, but an emulator only finds its BIOS in its own config
//! dir. This copies each staged blob into the right place, non-destructively
//! (an existing file at the destination is never overwritten — emulators are
//! picky about exact dumps and the user may have placed their own).
//!
//! Only copy-installable BIOS are handled here. DuckStation (PS1) and PCSX2
//! (PS2) read a loose BIOS file from a `bios/` dir, so a plain copy works.
//! RPCS3 firmware (`PS3UPDAT.PUP`) must be *imported* by the emulator (it's an
//! update package, not a flat firmware image), so it is intentionally not
//! placed by copying — that would silently do nothing useful.

use std::path::{Path, PathBuf};

/// One staged BIOS file and the emulator bios dir it belongs in.
pub struct BiosJob {
    /// Staged file name under `<app_data>/emulators/`.
    pub staged: &'static str,
    /// Destination directory (an emulator's bios folder).
    pub dest_dir: PathBuf,
    /// For logging which emulator this serves.
    pub emulator: &'static str,
}

/// The known, copy-installable BIOS placements given the staging dir and each
/// emulator's bios dir. Callers pass the resolved per-emulator dirs (which need
/// platform path lookups), keeping this pure and testable.
pub fn plan(duckstation_bios: PathBuf, pcsx2_bios: PathBuf) -> Vec<BiosJob> {
    vec![
        BiosJob { staged: "scph1001.bin", dest_dir: duckstation_bios, emulator: "DuckStation" },
        // PCSX2 reads any valid PS2 BIOS dump from its bios dir; we place the
        // common dump name if the server staged it under this name.
        BiosJob { staged: "ps2-bios.bin", dest_dir: pcsx2_bios, emulator: "PCSX2" },
    ]
}

/// Outcome of attempting one BIOS placement.
#[derive(Debug, Clone, PartialEq)]
pub enum Placement {
    /// Copied the staged file into place.
    Placed(String),
    /// Destination already had a file — left untouched.
    AlreadyPresent(String),
    /// Nothing staged under this name — nothing to do.
    NotStaged(String),
    /// Copy failed.
    Failed(String),
}

/// Execute one job: copy `<staging>/<staged>` → `<dest_dir>/<staged>` unless the
/// source is missing or the destination already exists.
pub fn place(staging: &Path, job: &BiosJob) -> Placement {
    let src = staging.join(job.staged);
    if !src.is_file() {
        return Placement::NotStaged(format!("{}: {} not staged", job.emulator, job.staged));
    }
    let dest = job.dest_dir.join(job.staged);
    if dest.exists() {
        return Placement::AlreadyPresent(format!("{}: {} already present", job.emulator, job.staged));
    }
    if let Err(e) = std::fs::create_dir_all(&job.dest_dir) {
        return Placement::Failed(format!("{}: mkdir failed: {e}", job.emulator));
    }
    match std::fs::copy(&src, &dest) {
        Ok(_) => Placement::Placed(format!("{}: placed {}", job.emulator, job.staged)),
        Err(e) => Placement::Failed(format!("{}: copy failed: {e}", job.emulator)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("bios_test_{}_{}", std::process::id(), name))
    }

    #[test]
    fn places_when_staged_and_dest_empty() {
        let staging = tmp("stage_a");
        let dest = tmp("ds_a");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("scph1001.bin"), b"biosdata").unwrap();
        let job = BiosJob { staged: "scph1001.bin", dest_dir: dest.clone(), emulator: "DuckStation" };

        let r = place(&staging, &job);
        assert!(matches!(r, Placement::Placed(_)));
        assert!(dest.join("scph1001.bin").is_file());

        // Idempotent: second run sees it present.
        assert!(matches!(place(&staging, &job), Placement::AlreadyPresent(_)));

        std::fs::remove_dir_all(&staging).ok();
        std::fs::remove_dir_all(&dest).ok();
    }

    #[test]
    fn not_staged_is_noop() {
        let staging = tmp("stage_b");
        std::fs::create_dir_all(&staging).unwrap();
        let job = BiosJob { staged: "scph1001.bin", dest_dir: tmp("ds_b"), emulator: "DuckStation" };
        assert!(matches!(place(&staging, &job), Placement::NotStaged(_)));
        std::fs::remove_dir_all(&staging).ok();
    }
}
