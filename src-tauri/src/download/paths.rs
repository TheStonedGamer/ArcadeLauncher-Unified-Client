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
}
