//! Fetch-on-first-enable for the **host** half of the stream engine.
//!
//! The bundled stream engine can *play* a stream out of the box, but being a
//! GameStream **host** needs the (large, ~tens-of-MB) Sunshine fork, which the
//! installer deliberately does NOT bundle — most users only ever stream *from*
//! other PCs. Instead, the first time a PC enables "Stream from this PC" we
//! download the Sunshine sidecar from the engine's GitHub release into the app
//! data dir and point the engine at it via `ARCADE_SUNSHINE`.
//!
//! This file is the IO-free core: which asset to fetch, from where, and where it
//! lands on disk. The download/extract/env-set transport lives in
//! [`host_fetch_commands`](super::host_fetch_commands); it reuses the same
//! zip-slip-safe [`extract_zip`](crate::download::extract::extract_zip) the game
//! installer uses, so the Sunshine asset is published as a `.zip` on **both**
//! platforms (no extra tar/gzip dep).

use std::path::{Path, PathBuf};

/// The engine release tag whose assets we pull the Sunshine host sidecar from.
///
/// **Bump this in lockstep with the engine release that publishes the
/// `ArcadeLauncher-Sunshine-<ver>-<os>-x64.zip` asset** (the engine's
/// `release.yml` "Sunshine host" job). Until such a release exists the fetch
/// 404s and host mode degrades to an honest "couldn't download" notice — it
/// never bundles a half-baked host.
pub const SUNSHINE_HOST_VERSION: &str = "0.3.1";

/// GitHub owner/repo that publishes the engine (and the Sunshine host asset).
const ENGINE_REPO: &str = "TheStonedGamer/ArcadeLauncher-StreamEngine";

/// The OS slug used in the published asset filename.
const fn os_slug() -> &'static str {
    if cfg!(windows) {
        "win"
    } else {
        "linux"
    }
}

/// The Sunshine host binary's filename for this platform.
pub fn sunshine_bin_name() -> &'static str {
    if cfg!(windows) {
        "sunshine.exe"
    } else {
        "sunshine"
    }
}

/// The published asset filename for `version`, e.g.
/// `ArcadeLauncher-Sunshine-0.3.0-win-x64.zip`.
pub fn host_asset_name(version: &str) -> String {
    format!("ArcadeLauncher-Sunshine-{version}-{}-x64.zip", os_slug())
}

/// The full GitHub release download URL for the Sunshine host asset.
pub fn host_asset_url(version: &str) -> String {
    format!(
        "https://github.com/{ENGINE_REPO}/releases/download/v{version}/{}",
        host_asset_name(version)
    )
}

/// Where a given engine `version`'s host sidecar is unpacked, under the app data
/// dir. Versioned so a newer engine's host binary lands in its own dir and a
/// stale one can be cleaned up without clobbering a running install.
pub fn host_install_dir(data_dir: &Path, version: &str) -> PathBuf {
    data_dir.join("host-engine").join(version)
}

/// The full path to the Sunshine binary for `version` under the app data dir.
/// This is the value handed to the engine via `ARCADE_SUNSHINE`.
pub fn sunshine_bin_path(data_dir: &Path, version: &str) -> PathBuf {
    host_install_dir(data_dir, version).join(sunshine_bin_name())
}

/// Whether the Sunshine host binary is present (and a regular file) at `path`.
pub fn is_installed(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_name_carries_version_and_os() {
        let name = host_asset_name("1.2.3");
        assert!(name.starts_with("ArcadeLauncher-Sunshine-1.2.3-"));
        assert!(name.ends_with("-x64.zip"));
        // Exactly one of the two OS slugs, matching this build target.
        assert!(name.contains(if cfg!(windows) { "-win-" } else { "-linux-" }));
    }

    #[test]
    fn asset_url_is_the_release_download_path() {
        let url = host_asset_url("0.3.0");
        assert!(url.starts_with(
            "https://github.com/TheStonedGamer/ArcadeLauncher-StreamEngine/releases/download/v0.3.0/"
        ));
        assert!(url.ends_with(&host_asset_name("0.3.0")));
    }

    #[test]
    fn install_dir_is_versioned_under_data() {
        let base = Path::new("/data");
        let dir = host_install_dir(base, "0.3.0");
        assert!(dir.ends_with(Path::new("host-engine/0.3.0")));
        assert!(dir.starts_with(base));
    }

    #[test]
    fn bin_path_sits_in_the_install_dir() {
        let base = Path::new("/data");
        let bin = sunshine_bin_path(base, "0.3.0");
        assert_eq!(bin.parent().unwrap(), host_install_dir(base, "0.3.0"));
        assert_eq!(bin.file_name().unwrap(), sunshine_bin_name());
    }

    #[test]
    fn bin_name_matches_platform() {
        let name = sunshine_bin_name();
        if cfg!(windows) {
            assert_eq!(name, "sunshine.exe");
        } else {
            assert_eq!(name, "sunshine");
        }
    }

    #[test]
    fn is_installed_tracks_a_real_file() {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_host_fetch_test_{}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        assert!(!is_installed(&p));
        std::fs::write(&p, b"binary").unwrap();
        assert!(is_installed(&p));
        let _ = std::fs::remove_file(&p);
    }
}
