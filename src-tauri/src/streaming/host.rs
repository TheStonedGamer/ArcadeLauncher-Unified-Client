//! Remote game-streaming host model (T12k-1). Pure, IO-free core for the
//! Sunshine/Moonlight streaming bet: it models a streaming **host** (a PC
//! running Sunshine), parses Sunshine's `apps.json` app list, and answers the
//! one decision the UI needs up front — *can this game be streamed from host
//! X?* — without performing any network or disk IO.
//!
//! The transport that actually pairs with and queries a live Sunshine host
//! (its HTTPS config API on `:47990`) is the T12k-2 seam built on top of this;
//! this layer only owns the config/JSON shapes and the availability decision so
//! they can be exhaustively KAT-tested the way the rest of the portable core is.

use serde::{Deserialize, Serialize};

/// Sunshine's default HTTPS config-API port. The host control seam (T12k-2)
/// talks to `https://<address>:47990`; exposed here so the URL shape lives with
/// the model rather than being re-derived at the transport layer.
pub const SUNSHINE_CONFIG_PORT: u16 = 47990;

/// Where a streaming host stands from the launcher's point of view. Mirrors the
/// `installState`-style string enums elsewhere so the UI can render a host
/// uniformly. `Unknown` is the pre-probe default — we have a host on record but
/// have not yet reached its config API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum HostState {
    /// On record but not yet probed.
    #[default]
    Unknown,
    /// Probed and unreachable.
    Offline,
    /// Probed and reachable (Sunshine answered).
    Online,
}

impl HostState {
    /// The wire/UI string for this state.
    pub fn as_str(self) -> &'static str {
        match self {
            HostState::Unknown => "unknown",
            HostState::Offline => "offline",
            HostState::Online => "online",
        }
    }
}

/// A configured streaming host. `address` is the bare host (IP or DNS name, no
/// scheme/port); `paired` records whether we have completed Sunshine's PIN
/// pairing with it; `state` is the last-probed reachability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StreamHost {
    /// Friendly display name (defaults to the address if the user gives none).
    pub name: String,
    /// Bare host: IP or DNS name, no scheme and no port.
    pub address: String,
    /// Whether Sunshine PIN pairing has been completed with this host.
    pub paired: bool,
    /// Last-probed reachability.
    pub state: HostState,
    /// Pinned SHA-256 fingerprint (lowercase hex) of the host's self-signed
    /// config-API certificate, recorded on first pair (TOFU). Empty until then;
    /// the transport requires a presented cert to match this before trusting a
    /// connection. Client-local only.
    #[serde(default)]
    pub fingerprint: String,
}

impl StreamHost {
    /// A new host record from an address, named after the address until the user
    /// renames it. Trims surrounding whitespace; a host with a blank address is
    /// not useful but is left to the caller to reject.
    pub fn new(address: &str) -> Self {
        let address = address.trim().to_string();
        StreamHost {
            name: address.clone(),
            address,
            paired: false,
            state: HostState::Unknown,
            fingerprint: String::new(),
        }
    }

    /// The base URL of this host's Sunshine config API, e.g.
    /// `https://10.0.0.5:47990`. Always HTTPS — Sunshine serves its config API
    /// over TLS (self-signed; the transport pins the cert rather than disabling
    /// verification).
    pub fn config_base_url(&self) -> String {
        format!("https://{}:{}", self.address.trim(), SUNSHINE_CONFIG_PORT)
    }

    /// Whether this host is ready to stream *anything*: reachable and paired.
    /// A host that is online but unpaired still needs the PIN flow; a paired but
    /// offline host can't stream right now.
    pub fn is_ready(&self) -> bool {
        self.paired && self.state == HostState::Online
    }
}

/// One entry from Sunshine's `apps.json` — we only care about the app `name`,
/// which is what a launch request targets. Unknown fields (image-path, cmd,
/// detached, …) are ignored so a richer `apps.json` still parses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SunshineApp {
    pub name: String,
}

/// The shape of a Sunshine `apps.json` file: an `apps` array plus other keys
/// (`env`, …) we ignore.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
struct SunshineApps {
    apps: Vec<SunshineApp>,
}

/// Parse a Sunshine `apps.json` document into its app list. Tolerant: a missing
/// `apps` key, unknown sibling keys, and unknown per-app fields all parse;
/// entries with a blank `name` are dropped (Sunshine never ships a nameless
/// app, and a nameless app can't be a launch target). Returns an error only on
/// genuinely malformed JSON.
pub fn parse_apps(json: &str) -> Result<Vec<SunshineApp>, serde_json::Error> {
    let parsed: SunshineApps = serde_json::from_str(json)?;
    Ok(parsed
        .apps
        .into_iter()
        .filter(|a| !a.name.trim().is_empty())
        .collect())
}

/// Case- and whitespace-insensitive match between a Sunshine app name and a
/// launcher game name. Sunshine app names are user-entered, so we normalise both
/// sides (trim + lowercase) before comparing rather than demanding an exact
/// byte match.
pub fn app_matches_game(app_name: &str, game_name: &str) -> bool {
    app_name.trim().eq_ignore_ascii_case(game_name.trim())
}

/// Whether `game_name` can be streamed from `host` given its advertised `apps`.
/// True only when the host is ready (paired + online) **and** one of its
/// Sunshine apps matches the game by name. A blank game name never matches.
pub fn is_streamable(host: &StreamHost, apps: &[SunshineApp], game_name: &str) -> bool {
    if game_name.trim().is_empty() || !host.is_ready() {
        return false;
    }
    apps.iter().any(|a| app_matches_game(&a.name, game_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_host() -> StreamHost {
        StreamHost {
            name: "Gaming PC".into(),
            address: "10.0.0.5".into(),
            paired: true,
            state: HostState::Online,
            fingerprint: "aa".into(),
        }
    }

    #[test]
    fn new_names_host_after_trimmed_address() {
        let h = StreamHost::new("  10.0.0.5  ");
        assert_eq!(h.address, "10.0.0.5");
        assert_eq!(h.name, "10.0.0.5");
        assert!(!h.paired);
        assert_eq!(h.state, HostState::Unknown);
    }

    #[test]
    fn config_base_url_is_https_on_47990() {
        let h = StreamHost::new("host.local");
        assert_eq!(h.config_base_url(), "https://host.local:47990");
        assert_eq!(SUNSHINE_CONFIG_PORT, 47990);
    }

    #[test]
    fn is_ready_requires_paired_and_online() {
        let mut h = ready_host();
        assert!(h.is_ready());
        h.paired = false;
        assert!(!h.is_ready());
        h.paired = true;
        h.state = HostState::Offline;
        assert!(!h.is_ready());
        h.state = HostState::Unknown;
        assert!(!h.is_ready());
    }

    #[test]
    fn host_state_strings() {
        assert_eq!(HostState::Unknown.as_str(), "unknown");
        assert_eq!(HostState::Offline.as_str(), "offline");
        assert_eq!(HostState::Online.as_str(), "online");
        assert_eq!(HostState::default(), HostState::Unknown);
    }

    #[test]
    fn parse_apps_extracts_names_and_drops_blanks() {
        let json = r#"{
            "env": { "PATH": "/usr/bin" },
            "apps": [
                { "name": "Desktop", "image-path": "desktop.png" },
                { "name": "  ", "cmd": "noop" },
                { "name": "Halo Infinite", "detached": ["x"] }
            ]
        }"#;
        let apps = parse_apps(json).unwrap();
        let names: Vec<&str> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["Desktop", "Halo Infinite"]);
    }

    #[test]
    fn parse_apps_tolerates_missing_apps_key() {
        let apps = parse_apps(r#"{"env":{}}"#).unwrap();
        assert!(apps.is_empty());
    }

    #[test]
    fn parse_apps_rejects_malformed_json() {
        assert!(parse_apps("not json").is_err());
    }

    #[test]
    fn app_matches_game_is_case_and_space_insensitive() {
        assert!(app_matches_game("Halo Infinite", "halo infinite"));
        assert!(app_matches_game("  Doom  ", "DOOM"));
        assert!(!app_matches_game("Doom", "Doom Eternal"));
        assert!(!app_matches_game("", "Doom"));
    }

    #[test]
    fn is_streamable_requires_ready_host_and_matching_app() {
        let host = ready_host();
        let apps = vec![
            SunshineApp { name: "Desktop".into() },
            SunshineApp { name: "Halo Infinite".into() },
        ];
        assert!(is_streamable(&host, &apps, "halo infinite"));
        // Game not in the app list.
        assert!(!is_streamable(&host, &apps, "Forza"));
        // Blank game never matches.
        assert!(!is_streamable(&host, &apps, "   "));
    }

    #[test]
    fn is_streamable_false_when_host_not_ready() {
        let apps = vec![SunshineApp { name: "Halo Infinite".into() }];
        let mut host = ready_host();
        host.paired = false;
        assert!(!is_streamable(&host, &apps, "Halo Infinite"));
        host.paired = true;
        host.state = HostState::Offline;
        assert!(!is_streamable(&host, &apps, "Halo Infinite"));
    }

    #[test]
    fn stream_host_round_trips_through_json() {
        let h = ready_host();
        let json = serde_json::to_string(&h).unwrap();
        let back: StreamHost = serde_json::from_str(&json).unwrap();
        assert_eq!(h, back);
        // camelCase + tolerant defaults: a partial record fills in.
        let partial: StreamHost =
            serde_json::from_str(r#"{"address":"1.2.3.4","state":"online"}"#).unwrap();
        assert_eq!(partial.address, "1.2.3.4");
        assert_eq!(partial.state, HostState::Online);
        assert!(!partial.paired);
    }
}
