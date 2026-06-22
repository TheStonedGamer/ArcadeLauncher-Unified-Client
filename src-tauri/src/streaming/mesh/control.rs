//! Mesh-VPN pure core (T12k-8 — play-from-anywhere). IO-free model for joining
//! the self-hosted **Headscale** overlay so a remote streaming host becomes
//! reachable by its mesh IP exactly as if it were on the LAN.
//!
//! Like the rest of the streaming subsystem this is the pure-core-first layer:
//! it owns the join-argument shape, the Tailscale-CGNAT address model, the
//! `tailscale status --json` parsing, and the **LAN-vs-mesh address selection**
//! decision — all without performing any network, process, or disk IO. The
//! transport that actually spawns/​supervises the bundled `tailscaled` and talks
//! to its LocalAPI is the `conn` seam built on top of this (mirrors
//! `host`→`engine_conn`). Keeping the decisions here lets them be exhaustively
//! KAT-tested the way the rest of the portable core is.

use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;

/// The self-hosted Headscale control server every device joins. The launcher
/// never talks to Tailscale's SaaS coordination — only this. Lives with the
/// model so the transport doesn't re-derive it.
pub const HEADSCALE_LOGIN_SERVER: &str = "https://headscale.orlandoaio.net";

/// Tailscale hands every node an address out of the `100.64.0.0/10` CGNAT
/// range (RFC 6598). The host announces its mesh address from this block; we
/// validate against it so a bogus/empty announce can't be fed to the streamer.
const CGNAT_NETWORK: u32 = 0x6440_0000; // 100.64.0.0
const CGNAT_PREFIX_BITS: u32 = 10;

/// True when `ip` is a syntactically valid IPv4 address inside Tailscale's
/// `100.64.0.0/10` mesh range. Anything else (LAN IPs, public IPs, garbage,
/// IPv6) is rejected — the mesh path only ever uses a CGNAT address.
pub fn is_mesh_ip(ip: &str) -> bool {
    match ip.trim().parse::<Ipv4Addr>() {
        Ok(v4) => {
            let bits = u32::from(v4);
            let mask = u32::MAX << (32 - CGNAT_PREFIX_BITS);
            (bits & mask) == (CGNAT_NETWORK & mask)
        }
        Err(_) => false,
    }
}

/// Parameters for bringing the node up against Headscale with an
/// account-minted pre-auth key. The launcher drives `tailscaled` via its
/// LocalAPI, but the CLI-equivalent argv ([`Self::cli_args`]) is the stable,
/// documented contract and the fallback path, so we model it here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpArgs {
    /// Headscale control URL — defaults to [`HEADSCALE_LOGIN_SERVER`].
    pub login_server: String,
    /// The single-use pre-auth key the ArcadeLauncher server minted for this
    /// device (see server `POST /api/social/mesh/preauth`).
    pub auth_key: String,
    /// Stable per-device node name so the host can be found by hostname in the
    /// peer list (and so re-joins reuse the same node, not pile up duplicates).
    pub hostname: String,
    /// Register as ephemeral — the node is auto-reaped by Headscale shortly
    /// after it goes offline, so transient clients don't accumulate. Hosts that
    /// must be wake-able/persistent set this false.
    pub ephemeral: bool,
}

impl UpArgs {
    /// A client (consumer) join: ephemeral, default control server.
    pub fn client(auth_key: impl Into<String>, hostname: impl Into<String>) -> Self {
        Self {
            login_server: HEADSCALE_LOGIN_SERVER.to_string(),
            auth_key: auth_key.into(),
            hostname: hostname.into(),
            ephemeral: true,
        }
    }

    /// A host (the PC being streamed from) join: persistent so it stays
    /// listed/wake-able while asleep.
    pub fn host(auth_key: impl Into<String>, hostname: impl Into<String>) -> Self {
        Self {
            ephemeral: false,
            ..Self::client(auth_key, hostname)
        }
    }

    /// The `tailscale up …` argv this join maps to. `--reset` so a re-join with
    /// changed flags doesn't inherit stale prefs; `--accept-routes=false` and
    /// `--shields-up=false` are explicit because we only want point-to-point
    /// game traffic, no subnet routing surprises.
    pub fn cli_args(&self) -> Vec<String> {
        let mut args = vec![
            "up".to_string(),
            "--login-server".to_string(),
            self.login_server.clone(),
            "--auth-key".to_string(),
            self.auth_key.clone(),
            "--hostname".to_string(),
            self.hostname.clone(),
            "--reset".to_string(),
            "--accept-routes=false".to_string(),
            "--shields-up=false".to_string(),
        ];
        if self.ephemeral {
            // Ephemerality is a property of the pre-auth key in Headscale, but
            // pass the hint too for clients/CLIs that honor it.
            args.push("--advertise-tags=tag:client".to_string());
        }
        args
    }
}

/// Where the launcher is in the join lifecycle. Mirrors the string-enum state
/// style used elsewhere (`HostState`) so the UI renders it uniformly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MeshPhase {
    /// `tailscaled` not running / no interface.
    #[default]
    Down,
    /// Daemon up, authenticating against Headscale.
    Connecting,
    /// Joined; we hold a mesh IP and can resolve peers.
    Up,
    /// Join failed (bad/expired key, control unreachable, driver error).
    Error,
}

impl MeshPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            MeshPhase::Down => "down",
            MeshPhase::Connecting => "connecting",
            MeshPhase::Up => "up",
            MeshPhase::Error => "error",
        }
    }
}

/// Snapshot of the local node's mesh membership, surfaced to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MeshState {
    pub phase: MeshPhase,
    /// Our own mesh IP once `Up`.
    pub self_ip: Option<String>,
    /// Human-readable last error when `phase == Error`.
    pub last_error: Option<String>,
}

// ---- `tailscale status --json` parsing -------------------------------------
//
// We model only the subset we consume: the local node (`Self`) and the peer map
// (`Peer`), each carrying `HostName`, `TailscaleIPs`, and `Online`. Unknown
// fields are ignored so Tailscale can evolve its schema without breaking us.

#[derive(Debug, Clone, Deserialize)]
struct StatusNode {
    #[serde(rename = "HostName", default)]
    host_name: String,
    #[serde(rename = "TailscaleIPs", default)]
    tailscale_ips: Vec<String>,
    #[serde(rename = "Online", default)]
    online: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct Status {
    #[serde(rename = "Self")]
    self_node: Option<StatusNode>,
    #[serde(rename = "Peer", default)]
    peer: std::collections::HashMap<String, StatusNode>,
}

/// First CGNAT (`100.64.0.0/10`) address among a node's advertised IPs — a node
/// can carry both v4 and v6, we want the v4 mesh IP the streamer dials.
fn first_mesh_ip(ips: &[String]) -> Option<String> {
    ips.iter().find(|ip| is_mesh_ip(ip)).cloned()
}

/// Our own mesh IP from a `tailscale status --json` document, if joined.
pub fn parse_self_mesh_ip(status_json: &str) -> Option<String> {
    let status: Status = serde_json::from_str(status_json).ok()?;
    first_mesh_ip(&status.self_node?.tailscale_ips)
}

/// Resolve a peer host's mesh IP by its node hostname, only if it's online.
/// Returns `None` when the host isn't in the tailnet, is offline, or has no
/// CGNAT address — every case where the mesh path is not usable right now.
pub fn peer_mesh_ip(status_json: &str, hostname: &str) -> Option<String> {
    let status: Status = serde_json::from_str(status_json).ok()?;
    status
        .peer
        .values()
        .find(|n| n.host_name.eq_ignore_ascii_case(hostname) && n.online)
        .and_then(|n| first_mesh_ip(&n.tailscale_ips))
}

// ---- LAN-vs-mesh address selection -----------------------------------------

/// The address the streamer should dial, tagged with which path it is so the UI
/// can show "Local" vs "Remote (mesh)" and so we never silently route LAN play
/// over WireGuard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "address")]
pub enum StreamAddr {
    /// Direct LAN address — the fast path, no tunnel.
    Lan(String),
    /// Mesh (Headscale/WireGuard) address — used only when LAN isn't reachable.
    Mesh(String),
}

impl StreamAddr {
    pub fn address(&self) -> &str {
        match self {
            StreamAddr::Lan(a) | StreamAddr::Mesh(a) => a,
        }
    }
    pub fn is_mesh(&self) -> bool {
        matches!(self, StreamAddr::Mesh(_))
    }
}

/// Pick the address to stream to. **Prefer LAN whenever it is reachable** (game
/// traffic stays off the tunnel for lowest latency); otherwise fall back to a
/// valid mesh address. Returns `None` when neither path is usable — the host is
/// unreachable and the UI should show it offline rather than dial a dead route.
///
/// `mesh` is validated against the CGNAT range so an empty/garbage announce is
/// treated as "no mesh path", not a bad dial.
pub fn select_stream_address(
    lan: Option<&str>,
    lan_reachable: bool,
    mesh: Option<&str>,
) -> Option<StreamAddr> {
    if lan_reachable {
        if let Some(addr) = lan.map(str::trim).filter(|a| !a.is_empty()) {
            return Some(StreamAddr::Lan(addr.to_string()));
        }
    }
    mesh.map(str::trim)
        .filter(|a| is_mesh_ip(a))
        .map(|a| StreamAddr::Mesh(a.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cgnat_membership_boundaries() {
        // In range: 100.64.0.0 – 100.127.255.255.
        assert!(is_mesh_ip("100.64.0.0"));
        assert!(is_mesh_ip("100.64.0.1"));
        assert!(is_mesh_ip("100.100.50.7"));
        assert!(is_mesh_ip("100.127.255.255"));
        // Just outside both edges.
        assert!(!is_mesh_ip("100.63.255.255"));
        assert!(!is_mesh_ip("100.128.0.0"));
        // Ordinary LAN / public / garbage / v6.
        assert!(!is_mesh_ip("10.0.0.222"));
        assert!(!is_mesh_ip("192.168.1.10"));
        assert!(!is_mesh_ip("8.8.8.8"));
        assert!(!is_mesh_ip("not-an-ip"));
        assert!(!is_mesh_ip(""));
        assert!(!is_mesh_ip("fd7a:115c:a1e0::1"));
    }

    #[test]
    fn mesh_ip_trims_whitespace() {
        assert!(is_mesh_ip("  100.64.0.1  "));
    }

    #[test]
    fn up_args_client_is_ephemeral_with_defaults() {
        let a = UpArgs::client("KEY123", "brian-deck");
        assert_eq!(a.login_server, HEADSCALE_LOGIN_SERVER);
        assert!(a.ephemeral);
        let argv = a.cli_args();
        assert_eq!(argv[0], "up");
        // login server + key + hostname all present, in flag/value pairs.
        let pos = |f: &str| argv.iter().position(|x| x == f).map(|i| &argv[i + 1]);
        assert_eq!(pos("--login-server").unwrap(), HEADSCALE_LOGIN_SERVER);
        assert_eq!(pos("--auth-key").unwrap(), "KEY123");
        assert_eq!(pos("--hostname").unwrap(), "brian-deck");
        assert!(argv.iter().any(|x| x == "--reset"));
        assert!(argv.iter().any(|x| x == "--accept-routes=false"));
    }

    #[test]
    fn up_args_host_is_persistent() {
        let a = UpArgs::host("KEY", "living-room-pc");
        assert!(!a.ephemeral);
        // No client tag on a host join.
        assert!(!a.cli_args().iter().any(|x| x == "--advertise-tags=tag:client"));
    }

    const STATUS: &str = r#"{
        "Self": {"HostName":"brian-deck","TailscaleIPs":["100.64.0.5","fd7a:115c::5"],"Online":true},
        "Peer": {
            "nodekey:aaa": {"HostName":"living-room-pc","TailscaleIPs":["100.64.0.9"],"Online":true},
            "nodekey:bbb": {"HostName":"office-pc","TailscaleIPs":["100.64.0.20"],"Online":false}
        }
    }"#;

    #[test]
    fn parses_self_mesh_ip_preferring_v4() {
        assert_eq!(parse_self_mesh_ip(STATUS).as_deref(), Some("100.64.0.5"));
    }

    #[test]
    fn resolves_online_peer_by_hostname_case_insensitive() {
        assert_eq!(peer_mesh_ip(STATUS, "living-room-pc").as_deref(), Some("100.64.0.9"));
        assert_eq!(peer_mesh_ip(STATUS, "LIVING-ROOM-PC").as_deref(), Some("100.64.0.9"));
    }

    #[test]
    fn offline_or_absent_peer_has_no_mesh_ip() {
        assert_eq!(peer_mesh_ip(STATUS, "office-pc"), None); // present but offline
        assert_eq!(peer_mesh_ip(STATUS, "nas"), None); // not in tailnet
    }

    #[test]
    fn status_parsing_is_resilient_to_garbage() {
        assert_eq!(parse_self_mesh_ip("not json"), None);
        assert_eq!(peer_mesh_ip("{}", "anything"), None);
    }

    #[test]
    fn selection_prefers_reachable_lan() {
        let got = select_stream_address(Some("10.0.0.50"), true, Some("100.64.0.9"));
        assert_eq!(got, Some(StreamAddr::Lan("10.0.0.50".to_string())));
        assert!(!got.unwrap().is_mesh());
    }

    #[test]
    fn selection_falls_back_to_mesh_when_lan_unreachable() {
        let got = select_stream_address(Some("10.0.0.50"), false, Some("100.64.0.9"));
        assert_eq!(got, Some(StreamAddr::Mesh("100.64.0.9".to_string())));
        assert!(got.unwrap().is_mesh());
    }

    #[test]
    fn selection_uses_mesh_when_no_lan_known() {
        let got = select_stream_address(None, true, Some("100.64.0.9"));
        assert_eq!(got, Some(StreamAddr::Mesh("100.64.0.9".to_string())));
    }

    #[test]
    fn selection_rejects_invalid_mesh_announce() {
        // LAN unreachable and the "mesh" address is not a CGNAT IP -> no route.
        assert_eq!(select_stream_address(Some("10.0.0.50"), false, Some("")), None);
        assert_eq!(select_stream_address(None, false, Some("192.168.1.5")), None);
        assert_eq!(select_stream_address(None, false, None), None);
    }

    #[test]
    fn selection_ignores_blank_lan_even_if_reachable() {
        // Blank LAN but reachable flag set: fall through to mesh, don't dial "".
        let got = select_stream_address(Some("   "), true, Some("100.64.0.9"));
        assert_eq!(got, Some(StreamAddr::Mesh("100.64.0.9".to_string())));
    }
}
