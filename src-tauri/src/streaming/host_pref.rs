//! Persisted "Let this PC be streamed" preference.
//!
//! Host mode is stateful (the [`HostSession`](super::host_session::HostSession)
//! owns the Sunshine child) but that state lives only for the launcher process —
//! nothing re-enabled hosting on the next launch, so the Settings toggle looked
//! like it "didn't persist". This tiny store records the user's intent so the
//! app can auto-restore host mode at startup (see `lib.rs` setup).
//!
//! Kept deliberately separate from `config.json` (General settings): the toggle
//! lives in `useHosting`, not the settings draft, so persisting it through the
//! General save path would let a stale draft clobber it. A dedicated one-field
//! file sidesteps that entirely. Same atomic temp-file+rename write as the other
//! stores, so a crash mid-write can't corrupt it.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The persisted host-enable intent. One field; `default` covers a first run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HostPref {
    pub enabled: bool,
}

/// The on-disk path within the per-user config dir.
pub fn path(config_dir: &Path) -> PathBuf {
    config_dir.join("host_pref.json")
}

/// Read the saved intent. A missing/empty/corrupt file means "not enabled" —
/// never an error, so a clean profile or a partial write just falls back to off.
pub fn load(config_dir: &Path) -> bool {
    let p = path(config_dir);
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str::<HostPref>(&t).ok())
        .map(|h| h.enabled)
        .unwrap_or(false)
}

/// Persist the intent atomically (temp file + rename), creating the dir if needed.
pub fn save(config_dir: &Path, enabled: bool) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let p = path(config_dir);
    let json = serde_json::to_string_pretty(&HostPref { enabled })?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_hostpref_test_{}_{}", std::process::id(), name));
        p
    }

    #[test]
    fn missing_file_is_off() {
        let dir = tmp_dir("missing");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!load(&dir));
    }

    #[test]
    fn round_trip_on_then_off() {
        let dir = tmp_dir("rt");
        let _ = std::fs::remove_dir_all(&dir);
        save(&dir, true).unwrap();
        assert!(load(&dir));
        save(&dir, false).unwrap();
        assert!(!load(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_falls_back_to_off() {
        let dir = tmp_dir("corrupt");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(path(&dir), "{ not json").unwrap();
        assert!(!load(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
