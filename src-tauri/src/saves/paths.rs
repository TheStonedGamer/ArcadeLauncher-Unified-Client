//! Pure save-path helpers. The server identifies a save file by a relative,
//! `/`-separated `path` and rejects anything that could escape the per-user
//! save area. These helpers mirror the server's `valid_save_path` rules exactly
//! and turn an on-disk file (under a known base dir) into that wire path — all
//! without touching the filesystem, so the rules are unit-tested in isolation.

use std::path::Path;

/// Mirror of the server's `valid_save_path`: non-empty, ≤400 bytes, no leading
/// `/`, no backslashes, no NUL, and no empty / `.` / `..` path segment. A path
/// the server would reject is one we must never send (or accept).
pub fn valid_save_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 400
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains('\0')
        && !p.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

/// Compute the server-style relative save path for `full`, which must live under
/// `base`. Returns `None` if `full` is not under `base` or the resulting path is
/// not `valid_save_path` (so a symlink or odd component can't smuggle a bad
/// path to the server). Separators are normalised to `/`.
pub fn to_rel_save_path(base: &Path, full: &Path) -> Option<String> {
    let rel = full.strip_prefix(base).ok()?;
    // Join components with `/` regardless of the host separator.
    let mut parts: Vec<String> = Vec::new();
    for comp in rel.components() {
        match comp {
            std::path::Component::Normal(os) => parts.push(os.to_str()?.to_string()),
            // Anything else (RootDir, ParentDir, Prefix, CurDir) is unsafe/odd.
            _ => return None,
        }
    }
    let joined = parts.join("/");
    valid_save_path(&joined).then_some(joined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn valid_path_accepts_normal_relatives() {
        assert!(valid_save_path("save0.dat"));
        assert!(valid_save_path("slot1/player.sav"));
        assert!(valid_save_path("a/b/c/d.bin"));
    }

    #[test]
    fn valid_path_rejects_unsafe() {
        assert!(!valid_save_path(""));
        assert!(!valid_save_path("/abs.sav"));
        assert!(!valid_save_path("dir\\file.sav"));
        assert!(!valid_save_path("../escape.sav"));
        assert!(!valid_save_path("a/./b.sav"));
        assert!(!valid_save_path("a//b.sav"));
        assert!(!valid_save_path(&"x".repeat(401)));
        assert!(!valid_save_path("has\0nul"));
    }

    #[test]
    fn rel_path_under_base_joins_with_forward_slashes() {
        let base = PathBuf::from("/saves/zelda");
        let full = base.join("slot1").join("player.sav");
        assert_eq!(to_rel_save_path(&base, &full), Some("slot1/player.sav".to_string()));
    }

    #[test]
    fn rel_path_outside_base_is_none() {
        let base = PathBuf::from("/saves/zelda");
        let outside = PathBuf::from("/saves/mario/x.sav");
        assert_eq!(to_rel_save_path(&base, &outside), None);
    }

    #[test]
    fn rel_path_equal_to_base_is_none() {
        // The base dir itself has no relative file path.
        let base = PathBuf::from("/saves/zelda");
        assert_eq!(to_rel_save_path(&base, &base), None);
    }
}
