//! Local storefront integration. The launcher is a gateway to all gaming on the
//! PC, so it scans locally-installed Steam and Epic games and launches them via
//! their protocol handlers (`steam://`, `com.epicgames.launcher://`). No account
//! login is involved — this only reads each launcher's on-disk install manifests.

pub mod commands;
pub mod epic;
pub mod steam;

use serde::Serialize;

/// One installed game discovered from a local storefront, shown in its tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreGame {
    /// Stable per-source id (Steam appid, or Epic AppName).
    pub id: String,
    pub name: String,
    pub install_dir: String,
    /// Protocol URI that launches the game via its storefront.
    pub launch_uri: String,
    /// "steam" | "epic".
    pub source: String,
    /// Best-effort cover art URL (Steam CDN); empty when unavailable.
    pub cover_url: String,
    /// Fallback art URL tried if `cover_url` 404s (Steam header image).
    pub fallback_url: String,
}
