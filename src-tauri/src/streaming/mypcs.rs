//! Pure core for the account-brokered **My PCs** view (T12k-7 / T12k-9).
//!
//! IO-free, like the rest of the client core: it owns the `MyPc` / `MyPcApp`
//! wire models, the **self-exclusion** rule (you never stream to the device
//! you're sitting at), and **address selection** (prefer a reachable LAN address,
//! else a validated mesh address) by reusing
//! [`crate::streaming::mesh::control::select_stream_address`]. The transport that
//! gathers this machine's identity/addresses and talks to the server lives in
//! `mypcs_commands.rs`.

use crate::streaming::mesh::control::{select_stream_address, StreamAddr};
use serde::{Deserialize, Serialize};

/// One PC signed into the account, as returned by `GET /api/social/hosts`.
/// `online` is server-derived from `last_seen` freshness; an offline PC is still
/// listed (greyed) so its last-known library stays browsable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyPc {
    pub device_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub lan_addr: String,
    #[serde(default)]
    pub mesh_addr: String,
    #[serde(default)]
    pub cert_fp: String,
    /// The host's Sunshine server cert PEM, for zero-PIN auto-pair: the client pins this
    /// (engine `client.trustHost`) before `client.start` so streaming needs no PIN handshake.
    /// Empty until the host has published it (after its first host-enable).
    #[serde(default)]
    pub server_cert_pem: String,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub last_seen: i64,
}

/// One game published by a PC (`GET /api/social/hosts/:id/apps`). `cover_ref` is a
/// relative art reference (never an absolute path), resolved client-side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyPcApp {
    pub game_key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub cover_ref: String,
}

/// Drop this device from a device list. My PCs shows *other* devices on the
/// account — the machine you're on is hidden (you don't remote-play yourself).
/// A blank `self_id` excludes nothing (we simply don't know who we are yet).
pub fn exclude_self(pcs: Vec<MyPc>, self_id: &str) -> Vec<MyPc> {
    if self_id.is_empty() {
        return pcs;
    }
    pcs.into_iter().filter(|p| p.device_id != self_id).collect()
}

/// Pick the address to stream to for one PC: prefer its LAN address when LAN is
/// reachable, else its (CGNAT-validated) mesh address. `None` ⇒ no usable path,
/// so the UI should treat the PC as unreachable rather than dial a dead route.
pub fn pick_address(pc: &MyPc, lan_reachable: bool) -> Option<StreamAddr> {
    select_stream_address(Some(&pc.lan_addr), lan_reachable, Some(&pc.mesh_addr))
}

/// Whether a Play action should be offered: the PC is online *and* has a usable
/// connect path. Offline PCs stay listed (library browsable) but aren't playable.
pub fn is_playable(pc: &MyPc, lan_reachable: bool) -> bool {
    pc.online && pick_address(pc, lan_reachable).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pc(id: &str, lan: &str, mesh: &str, online: bool) -> MyPc {
        MyPc {
            device_id: id.into(),
            name: id.into(),
            lan_addr: lan.into(),
            mesh_addr: mesh.into(),
            cert_fp: String::new(),
            server_cert_pem: String::new(),
            online,
            last_seen: 0,
        }
    }

    #[test]
    fn excludes_self_device() {
        let list = vec![pc("a", "", "", true), pc("b", "", "", true)];
        let kept = exclude_self(list, "a");
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].device_id, "b");
    }

    #[test]
    fn blank_self_keeps_everything() {
        let list = vec![pc("a", "", "", true), pc("b", "", "", true)];
        assert_eq!(exclude_self(list, "").len(), 2);
    }

    #[test]
    fn prefers_lan_when_reachable() {
        let p = pc("a", "10.0.0.50", "100.64.0.9", true);
        assert_eq!(pick_address(&p, true), Some(StreamAddr::Lan("10.0.0.50".into())));
    }

    #[test]
    fn falls_back_to_mesh_when_lan_unreachable() {
        let p = pc("a", "10.0.0.50", "100.64.0.9", true);
        assert_eq!(pick_address(&p, false), Some(StreamAddr::Mesh("100.64.0.9".into())));
    }

    #[test]
    fn no_address_when_neither_path_usable() {
        // LAN unreachable and no valid mesh address ⇒ unplayable.
        let p = pc("a", "10.0.0.50", "", false);
        assert_eq!(pick_address(&p, false), None);
        assert!(!is_playable(&p, false));
    }

    #[test]
    fn offline_pc_is_not_playable_even_with_address() {
        let p = pc("a", "10.0.0.50", "100.64.0.9", false);
        assert!(!is_playable(&p, true));
    }

    #[test]
    fn online_pc_with_lan_is_playable() {
        let p = pc("a", "10.0.0.50", "", true);
        assert!(is_playable(&p, true));
    }
}
