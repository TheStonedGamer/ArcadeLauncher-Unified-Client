//! Safe resolution of a manifest file's install-relative path to an absolute
//! destination under the install directory. A malicious or buggy manifest must
//! never write outside the install dir, so any `..` component or absolute path
//! is rejected before a single byte is written — mirroring the C++ client's
//! `HasPathTraversal` guard.

use std::path::{Path, PathBuf};

/// True if `rel` contains a `..` path component (using either separator), the
/// same component-wise check the C++ client performs. Note a bare filename like
/// `..foo` is fine — only a whole component equal to `..` is rejected.
pub fn has_path_traversal(rel: &str) -> bool {
    rel.split(['/', '\\']).any(|component| component == "..")
}

/// True if `rel` is an absolute path (Unix `/...`, Windows `C:\...` or `\...`).
fn is_absolute_like(rel: &str) -> bool {
    rel.starts_with('/')
        || rel.starts_with('\\')
        || {
            let b = rel.as_bytes();
            // Drive-letter prefix: `C:` / `c:`.
            b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
        }
}

/// Resolve `rel` to an absolute path under `install_dir`, or `None` if `rel` is
/// unsafe (traversal, absolute, or empty). The returned path is never outside
/// `install_dir`.
pub fn resolve_target(install_dir: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || has_path_traversal(rel) || is_absolute_like(rel) {
        return None;
    }
    // Normalize separators so a Windows-style manifest path joins correctly on
    // any OS, then push each component.
    let mut out = install_dir.to_path_buf();
    for component in rel.split(['/', '\\']).filter(|c| !c.is_empty() && *c != ".") {
        out.push(component);
    }
    Some(out)
}

/// Reserved Windows device names. A folder named after one of these (any case,
/// with or without an extension) is invalid on Windows even though it is fine on
/// Linux, so a title that sanitizes to one is treated as unusable.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Turn a catalog/manifest title into a single folder name that is safe on both
/// Windows and Linux, or `None` if the title yields nothing usable (the caller
/// then falls back to the opaque game id). We replace the characters Windows
/// forbids in a path component (`< > : " / \ | ? *` and control chars) with a
/// space, collapse whitespace runs, trim leading/trailing spaces and dots
/// (Windows silently drops trailing dots/spaces), cap the length so the full
/// install path stays well under MAX_PATH, and reject the reserved device names.
pub fn safe_dir_name(title: &str) -> Option<String> {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if (c as u32) < 0x20 => ' ',
            c => c,
        })
        .collect();
    // Collapse internal whitespace runs to single spaces.
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // Trim leading/trailing spaces and dots, cap length, then re-trim in case the
    // cap landed on a trailing space/dot.
    let trimmed = collapsed.trim_matches(|c| c == ' ' || c == '.');
    let capped: String = trimmed.chars().take(120).collect();
    let capped = capped.trim_matches(|c| c == ' ' || c == '.').to_string();
    if capped.is_empty() {
        return None;
    }
    // Reject reserved device names (compared against the part before any dot).
    let stem = capped.split('.').next().unwrap_or(&capped);
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        return None;
    }
    Some(capped)
}

/// The base folder name to install `game_id` (titled `title`) into: the
/// sanitized title when usable, else the opaque game id. Collision handling
/// against other installs is layered on top by [`unique_install_dir`].
pub fn install_dir_name(game_id: &str, title: &str) -> String {
    safe_dir_name(title).unwrap_or_else(|| game_id.to_string())
}

/// A short, stable suffix derived from the game id, for disambiguating two games
/// whose titles sanitize to the same folder name. Uses the id's trailing token
/// (after the last separator), so `pc-fdc100f88077` → `fdc100f88077`.
pub fn id_suffix(game_id: &str) -> String {
    game_id
        .rsplit(['-', '_', '/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(game_id)
        .to_string()
}

/// Resolve the absolute install directory under `games_root` for a game. The
/// preferred name is the sanitized title (or the id); if `taken` reports that
/// candidate is already claimed by a *different* install, we append ` (id)` and,
/// failing that, fall back to the raw id (guaranteed unique per game). `taken`
/// lets the caller veto a candidate that collides with another record's dir or
/// an unrelated folder already on disk.
pub fn unique_install_dir(
    games_root: &Path,
    game_id: &str,
    title: &str,
    taken: impl Fn(&Path) -> bool,
) -> PathBuf {
    let base = install_dir_name(game_id, title);
    let primary = games_root.join(&base);
    if !taken(&primary) {
        return primary;
    }
    let disamb = games_root.join(format!("{base} ({})", id_suffix(game_id)));
    if !taken(&disamb) {
        return disamb;
    }
    games_root.join(game_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dotdot_components() {
        assert!(has_path_traversal("../etc/passwd"));
        assert!(has_path_traversal("data/../../x"));
        assert!(has_path_traversal("data\\..\\x"));
        assert!(has_path_traversal(".."));
    }

    #[test]
    fn allows_safe_relative_paths() {
        assert!(!has_path_traversal("game.exe"));
        assert!(!has_path_traversal("data/textures/0.pak"));
        // `..foo` is a filename, not a traversal component.
        assert!(!has_path_traversal("..foo/bar"));
    }

    #[test]
    fn resolve_joins_under_install_dir() {
        let base = Path::new("/games/zelda");
        let p = resolve_target(base, "data/a.pak").unwrap();
        assert_eq!(p, Path::new("/games/zelda/data/a.pak"));
    }

    #[test]
    fn resolve_normalizes_backslashes() {
        let base = Path::new("/games/zelda");
        let p = resolve_target(base, "data\\sub\\b.bin").unwrap();
        assert_eq!(p, Path::new("/games/zelda/data/sub/b.bin"));
    }

    #[test]
    fn resolve_rejects_unsafe() {
        let base = Path::new("/games/zelda");
        assert!(resolve_target(base, "../escape").is_none());
        assert!(resolve_target(base, "/etc/passwd").is_none());
        assert!(resolve_target(base, "\\\\server\\share").is_none());
        assert!(resolve_target(base, "C:\\Windows\\x").is_none());
        assert!(resolve_target(base, "").is_none());
    }

    #[test]
    fn safe_dir_name_keeps_clean_titles() {
        assert_eq!(safe_dir_name("Food Delivery Simulator").as_deref(), Some("Food Delivery Simulator"));
        assert_eq!(safe_dir_name("Crystalis").as_deref(), Some("Crystalis"));
    }

    #[test]
    fn safe_dir_name_strips_illegal_and_collapses() {
        // Forbidden chars become spaces, runs collapse, ends trim.
        assert_eq!(
            safe_dir_name("Ratchet & Clank: Up Your Arsenal").as_deref(),
            Some("Ratchet & Clank Up Your Arsenal")
        );
        assert_eq!(safe_dir_name("  Spaced   Out  ").as_deref(), Some("Spaced Out"));
        assert_eq!(safe_dir_name("Trailing dots...").as_deref(), Some("Trailing dots"));
        assert_eq!(safe_dir_name("a/b\\c|d?e*f").as_deref(), Some("a b c d e f"));
    }

    #[test]
    fn safe_dir_name_rejects_empty_and_reserved() {
        assert_eq!(safe_dir_name(""), None);
        assert_eq!(safe_dir_name("   "), None);
        assert_eq!(safe_dir_name("..."), None);
        assert_eq!(safe_dir_name(":?*"), None);
        assert_eq!(safe_dir_name("CON"), None);
        assert_eq!(safe_dir_name("nul"), None);
        assert_eq!(safe_dir_name("Com1"), None);
        // A device name with an extension is still reserved on Windows.
        assert_eq!(safe_dir_name("AUX.txt"), None);
    }

    #[test]
    fn install_dir_name_falls_back_to_id() {
        assert_eq!(install_dir_name("pc-abc123", "Real Title"), "Real Title");
        assert_eq!(install_dir_name("pc-abc123", ""), "pc-abc123");
        assert_eq!(install_dir_name("pc-abc123", "CON"), "pc-abc123");
    }

    #[test]
    fn id_suffix_takes_trailing_token() {
        assert_eq!(id_suffix("pc-fdc100f88077"), "fdc100f88077");
        assert_eq!(id_suffix("nes_abc"), "abc");
        assert_eq!(id_suffix("plain"), "plain");
    }

    #[test]
    fn unique_install_dir_picks_clean_then_disambiguates() {
        let root = Path::new("/games");
        // Nothing taken → clean title.
        let p = unique_install_dir(root, "pc-fdc100f88077", "Food Delivery Simulator", |_| false);
        assert_eq!(p, Path::new("/games/Food Delivery Simulator"));

        // Clean name taken → append the id suffix.
        let clean = root.join("Food Delivery Simulator");
        let p = unique_install_dir(root, "pc-fdc100f88077", "Food Delivery Simulator", |c| c == clean);
        assert_eq!(p, Path::new("/games/Food Delivery Simulator (fdc100f88077)"));

        // Both taken → fall back to the raw id.
        let p = unique_install_dir(root, "pc-fdc100f88077", "Food Delivery Simulator", |_| true);
        assert_eq!(p, Path::new("/games/pc-fdc100f88077"));
    }
}
