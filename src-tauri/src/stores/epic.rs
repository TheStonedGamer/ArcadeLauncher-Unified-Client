//! Epic Games library discovery. The Epic Games Launcher writes one JSON
//! `.item` manifest per installed game under
//! `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests`. We read the fields we
//! need and launch via the `com.epicgames.launcher://` protocol. Epic ships on
//! Windows only, so this is a no-op elsewhere.

use super::StoreGame;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicManifest {
    #[serde(default)]
    app_name: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    install_location: String,
    /// True for the actual game; helper/DLC manifests set this false.
    #[serde(default)]
    b_is_application: bool,
}

/// Scan the Epic manifests directory for installed applications.
pub fn scan() -> Vec<StoreGame> {
    let dir = match manifests_dir() {
        Some(d) => d,
        None => return Vec::new(),
    };
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("item") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(m) = serde_json::from_str::<EpicManifest>(&text) else {
            continue;
        };
        if m.app_name.is_empty() || !m.b_is_application {
            continue;
        }
        let name = if m.display_name.is_empty() {
            m.app_name.clone()
        } else {
            m.display_name.clone()
        };
        if !seen.insert(m.app_name.clone()) {
            continue;
        }
        games.push(StoreGame {
            launch_uri: format!(
                "com.epicgames.launcher://apps/{}?action=launch&silent=true",
                m.app_name
            ),
            id: m.app_name,
            name,
            install_dir: m.install_location,
            source: "epic".into(),
            // Epic has no stable public per-game art URL; cards fall back to a
            // name placeholder in the UI.
            cover_url: String::new(),
            fallback_url: String::new(),
        });
    }
    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    games
}

fn manifests_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        let base = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
        Some(
            std::path::PathBuf::from(base)
                .join("Epic")
                .join("EpicGamesLauncher")
                .join("Data")
                .join("Manifests"),
        )
    }
    #[cfg(not(windows))]
    {
        None
    }
}
