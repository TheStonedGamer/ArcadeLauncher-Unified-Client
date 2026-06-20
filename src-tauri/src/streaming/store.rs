//! Client-local streaming-host registry (T12k-2). Persists the set of Sunshine
//! hosts the user has paired with — address, friendly name, pairing state, and
//! the pinned cert fingerprint — to a separate per-user `streaming_hosts.json`,
//! never `library.json`. **Credentials are never stored here**: Sunshine Basic
//! auth user/pass are passed per-call from the frontend (held in memory like
//! the session password), so the on-disk file carries no secrets.
//!
//! The collection ops are pure; the load/save pair at the bottom is the only
//! disk seam and uses the same atomic temp-file+rename write as the other
//! stores, so a crash mid-write can't corrupt the registry.

use crate::error::AppResult;
use crate::streaming::host::StreamHost;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The persisted set of streaming hosts, keyed by address (one entry per host).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StreamHosts {
    pub hosts: Vec<StreamHost>,
}

impl StreamHosts {
    /// The host record for `address` (exact, trimmed match), if any.
    pub fn get(&self, address: &str) -> Option<&StreamHost> {
        let a = address.trim();
        self.hosts.iter().find(|h| h.address == a)
    }

    /// Insert or replace a host by address. A new host is appended; an existing
    /// one (same address) is replaced in place so its list position is stable.
    pub fn upsert(&mut self, host: StreamHost) {
        match self.hosts.iter_mut().find(|h| h.address == host.address) {
            Some(slot) => *slot = host,
            None => self.hosts.push(host),
        }
    }

    /// Drop a host by address. Returns whether one was present.
    pub fn remove(&mut self, address: &str) -> bool {
        let a = address.trim();
        let before = self.hosts.len();
        self.hosts.retain(|h| h.address != a);
        self.hosts.len() != before
    }

    /// The pinned fingerprint for `address`, if the host is on record and paired
    /// with a non-empty pin. Used to enforce TOFU on subsequent connections.
    pub fn pinned_fingerprint(&self, address: &str) -> Option<&str> {
        self.get(address)
            .map(|h| h.fingerprint.as_str())
            .filter(|f| !f.is_empty())
    }
}

/// Load the host registry from `path`. A missing or empty file yields an empty
/// set, so a first run (no hosts paired yet) is not an error.
pub fn load(path: &Path) -> AppResult<StreamHosts> {
    if !path.exists() {
        return Ok(StreamHosts::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(StreamHosts::default());
    }
    Ok(serde_json::from_str::<StreamHosts>(&text)?)
}

/// Save the host registry to `path` atomically (temp file + rename), creating
/// the parent directory if needed.
pub fn save(path: &Path, hosts: &StreamHosts) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(hosts)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::host::HostState;

    fn host(addr: &str, fp: &str) -> StreamHost {
        StreamHost {
            name: addr.into(),
            address: addr.into(),
            paired: !fp.is_empty(),
            state: HostState::Online,
            fingerprint: fp.into(),
        }
    }

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_streamhosts_test_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn upsert_appends_then_replaces_in_place() {
        let mut s = StreamHosts::default();
        s.upsert(host("10.0.0.5", ""));
        s.upsert(host("10.0.0.6", "bb"));
        assert_eq!(s.hosts.len(), 2);
        // Replace the first host (same address) — position is preserved.
        s.upsert(host("10.0.0.5", "aa"));
        assert_eq!(s.hosts.len(), 2);
        assert_eq!(s.hosts[0].address, "10.0.0.5");
        assert_eq!(s.hosts[0].fingerprint, "aa");
    }

    #[test]
    fn get_and_remove_trim_address() {
        let mut s = StreamHosts::default();
        s.upsert(host("10.0.0.5", "aa"));
        assert!(s.get("  10.0.0.5 ").is_some());
        assert!(s.remove(" 10.0.0.5  "));
        assert!(!s.remove("10.0.0.5"));
        assert!(s.get("10.0.0.5").is_none());
    }

    #[test]
    fn pinned_fingerprint_only_when_nonempty() {
        let mut s = StreamHosts::default();
        s.upsert(host("a", "aabb"));
        s.upsert(host("b", "")); // paired==false, no pin
        assert_eq!(s.pinned_fingerprint("a"), Some("aabb"));
        assert_eq!(s.pinned_fingerprint("b"), None);
        assert_eq!(s.pinned_fingerprint("missing"), None);
    }

    #[test]
    fn round_trip_and_missing_file() {
        let p = tmp_path("rt");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), StreamHosts::default());
        let mut s = StreamHosts::default();
        s.upsert(host("10.0.0.5", "aa"));
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap(), s);
        let _ = std::fs::remove_file(&p);
    }
}
