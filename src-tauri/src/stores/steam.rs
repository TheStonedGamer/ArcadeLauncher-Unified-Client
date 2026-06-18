//! Steam library discovery. Steam records installed apps as Valve KeyValues
//! (VDF) text: `steamapps/libraryfolders.vdf` lists every library folder, and
//! each library's `steamapps/appmanifest_<appid>.acf` describes one installed
//! app. We parse just the few fields we need with a tiny quoted-pair scanner
//! rather than pulling in a full VDF crate.

use super::StoreGame;
use std::path::{Path, PathBuf};

/// Candidate Steam install roots. The install itself is almost always at the
/// default location even when games live on other drives (handled via
/// `libraryfolders.vdf`), so probing a few well-known paths avoids a registry
/// dependency. Non-Windows uses the standard Linux Steam locations.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(p) = std::env::var(var) {
                roots.push(PathBuf::from(p).join("Steam"));
            }
        }
        roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            roots.push(home.join(".steam/steam"));
            roots.push(home.join(".local/share/Steam"));
        }
    }
    roots.retain(|p| p.is_dir());
    roots.dedup();
    roots
}

/// Extract the string value following the first occurrence of `"key"` on its
/// line, unescaping `\\` and `\"`. VDF/ACF values are double-quoted.
fn vdf_value(line: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let after = line.find(&needle).map(|i| i + needle.len())?;
    let rest = &line[after..];
    let start = rest.find('"')? + 1;
    let mut out = String::new();
    let mut chars = rest[start..].chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            }
            '"' => return Some(out),
            _ => out.push(c),
        }
    }
    None
}

/// All `"path"` values in libraryfolders.vdf — one per Steam library folder.
fn library_paths(steam_root: &Path) -> Vec<PathBuf> {
    let mut paths = vec![steam_root.to_path_buf()];
    let vdf = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = std::fs::read_to_string(&vdf) {
        for line in text.lines() {
            if let Some(p) = vdf_value(line, "path") {
                paths.push(PathBuf::from(p));
            }
        }
    }
    paths
}

fn parse_manifest(path: &Path) -> Option<StoreGame> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut appid = None;
    let mut name = None;
    let mut installdir = None;
    for line in text.lines() {
        if appid.is_none() {
            appid = vdf_value(line, "appid");
        }
        if name.is_none() {
            name = vdf_value(line, "name");
        }
        if installdir.is_none() {
            installdir = vdf_value(line, "installdir");
        }
    }
    let appid = appid?;
    let name = name.unwrap_or_else(|| installdir.clone().unwrap_or_else(|| appid.clone()));
    Some(StoreGame {
        launch_uri: format!("steam://rungameid/{appid}"),
        cover_url: format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
        ),
        fallback_url: format!(
            "https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg"
        ),
        id: appid,
        name,
        install_dir: installdir.unwrap_or_default(),
        source: "steam".into(),
    })
}

/// Scan every Steam library for installed apps. Skips Steam's own runtime/
/// redistributable "apps" (Steamworks Common Redistributables, appid 228980)
/// which aren't user-facing games.
pub fn scan() -> Vec<StoreGame> {
    const SKIP_APPIDS: [&str; 1] = ["228980"];
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in steam_roots() {
        for lib in library_paths(&root) {
            let steamapps = lib.join("steamapps");
            let Ok(rd) = std::fs::read_dir(&steamapps) else {
                continue;
            };
            for entry in rd.flatten() {
                let path = entry.path();
                let is_manifest = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"))
                    .unwrap_or(false);
                if !is_manifest {
                    continue;
                }
                if let Some(game) = parse_manifest(&path) {
                    if SKIP_APPIDS.contains(&game.id.as_str()) {
                        continue;
                    }
                    if seen.insert(game.id.clone()) {
                        games.push(game);
                    }
                }
            }
        }
    }
    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    games
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_value_extracts_and_unescapes() {
        let line = "\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"";
        assert_eq!(vdf_value(line, "path").as_deref(), Some(r"D:\SteamLibrary"));
        assert_eq!(vdf_value(line, "name"), None);
    }

    #[test]
    fn vdf_value_simple_pair() {
        assert_eq!(vdf_value("\t\"appid\"\t\t\"220\"", "appid").as_deref(), Some("220"));
        assert_eq!(
            vdf_value("\t\"name\"\t\t\"Half-Life 2\"", "name").as_deref(),
            Some("Half-Life 2")
        );
    }
}
