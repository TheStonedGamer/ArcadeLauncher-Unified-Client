//! Steam-style multi-library model: the set of install-root folders the user has
//! registered (one per drive/location) and which one is the default install
//! target. Pure and unit-tested — no IO. The small load/save seam lives in
//! `store.rs`; commands fold in disk-space + install counts on top.
//!
//! Back-compat: the implicit `app_data_dir/games` root is always present (seeded
//! by [`LibraryFolders::ensure_default`]) and starts out the default, so an old
//! user with a single library and the existing clean-title installs + startup
//! migration is completely undisturbed.

use serde::{Deserialize, Serialize};

/// One registered library folder (an install root on some drive/location).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryFolder {
    /// Absolute path of the install root. Stored with trailing separators trimmed.
    pub path: String,
    /// Whether new installs default to this folder. Exactly one is the default.
    pub is_default: bool,
}

/// The full set of registered library folders.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryFolders {
    pub folders: Vec<LibraryFolder>,
}

/// Comparison key for a path: separators unified to `/`, trailing separators
/// trimmed, and — on Windows only — lowercased, so `C:\Games` and `c:/games/`
/// compare equal. Pure string work; the path need not exist.
pub fn norm_key(path: &str) -> String {
    let unified = path.trim().replace('\\', "/");
    let trimmed = unified.trim_end_matches('/');
    let base = if trimmed.is_empty() { "/" } else { trimmed };
    if cfg!(windows) {
        base.to_lowercase()
    } else {
        base.to_string()
    }
}

/// True if `child` is the same path as, or nested inside, `parent`. Both are
/// compared via [`norm_key`].
pub fn is_within(child: &str, parent: &str) -> bool {
    let c = norm_key(child);
    let p = norm_key(parent);
    c == p || c.starts_with(&format!("{p}/"))
}

/// Trim a path for storage: strip surrounding whitespace and trailing separators
/// (but keep a bare root like `/`).
fn clean(path: &str) -> String {
    let p = path.trim();
    let trimmed = p.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        p.to_string()
    } else {
        trimmed.to_string()
    }
}

impl LibraryFolders {
    /// The default install root, if one is set.
    pub fn default_path(&self) -> Option<&str> {
        self.folders.iter().find(|f| f.is_default).map(|f| f.path.as_str())
    }

    /// Whether `path` is already registered (by normalized key). Used in tests
    /// and available for callers that want to pre-check before `add`.
    #[allow(dead_code)]
    pub fn contains(&self, path: &str) -> bool {
        let key = norm_key(path);
        self.folders.iter().any(|f| norm_key(&f.path) == key)
    }

    /// Register `path` as a new library folder. Rejects an empty path and any
    /// path that overlaps an existing folder (equal to, nested inside, or a
    /// parent of one) — overlapping roots would let one install land "inside"
    /// another library. The first folder added becomes the default.
    pub fn add(&mut self, path: &str) -> Result<(), String> {
        let stored = clean(path);
        if stored.is_empty() {
            return Err("empty library path".into());
        }
        for f in &self.folders {
            if is_within(&stored, &f.path) || is_within(&f.path, &stored) {
                return Err(format!("overlaps an existing library folder: {}", f.path));
            }
        }
        let is_default = self.folders.is_empty();
        self.folders.push(LibraryFolder { path: stored, is_default });
        Ok(())
    }

    /// Unregister `path`. Refuses to remove the default folder (the caller must
    /// reassign the default first) and errors if `path` isn't registered. Whether
    /// the folder still holds installs is the caller's concern (it has the records).
    pub fn remove(&mut self, path: &str) -> Result<(), String> {
        let key = norm_key(path);
        let idx = self
            .folders
            .iter()
            .position(|f| norm_key(&f.path) == key)
            .ok_or_else(|| "no such library folder".to_string())?;
        if self.folders[idx].is_default {
            return Err("can't remove the default library folder".into());
        }
        self.folders.remove(idx);
        Ok(())
    }

    /// Make `path` the default install target. Errors if `path` isn't registered.
    pub fn set_default(&mut self, path: &str) -> Result<(), String> {
        let key = norm_key(path);
        if !self.folders.iter().any(|f| norm_key(&f.path) == key) {
            return Err("no such library folder".into());
        }
        for f in &mut self.folders {
            f.is_default = norm_key(&f.path) == key;
        }
        Ok(())
    }

    /// Guarantee the invariants the rest of the app relies on: the implicit
    /// `app_games_dir` is always present, and exactly one folder is the default.
    /// A fresh or legacy user (no file / empty list) ends up with `app_games_dir`
    /// as the sole default, matching today's single-library behavior.
    pub fn ensure_default(&mut self, app_games_dir: &str) {
        let games_key = norm_key(app_games_dir);
        if !self.folders.iter().any(|f| norm_key(&f.path) == games_key) {
            let is_first = self.folders.is_empty();
            self.folders.push(LibraryFolder { path: clean(app_games_dir), is_default: is_first });
        }
        // Collapse to exactly one default: keep the first flagged, clear the rest.
        let mut seen = false;
        for f in &mut self.folders {
            if f.is_default {
                if seen {
                    f.is_default = false;
                } else {
                    seen = true;
                }
            }
        }
        // None flagged → prefer the implicit games dir, else the first folder.
        if !seen {
            if let Some(f) = self.folders.iter_mut().find(|f| norm_key(&f.path) == games_key) {
                f.is_default = true;
            } else if let Some(f) = self.folders.first_mut() {
                f.is_default = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_key_unifies_separators_and_trailing() {
        assert_eq!(norm_key("/games/"), norm_key("/games"));
        assert_eq!(norm_key("a/b\\c"), norm_key("a/b/c"));
        assert_eq!(norm_key("   /x/y/  "), "/x/y");
    }

    #[test]
    fn is_within_detects_nesting() {
        assert!(is_within("/games/zelda", "/games"));
        assert!(is_within("/games", "/games")); // same
        assert!(!is_within("/games", "/games/zelda")); // parent is not within child
        assert!(!is_within("/gamesextra", "/games")); // prefix but not a path child
    }

    #[test]
    fn add_first_is_default_then_dedupes_and_rejects_overlap() {
        let mut lf = LibraryFolders::default();
        lf.add("D:/Games").unwrap();
        assert!(lf.folders[0].is_default);
        // Trailing-slash duplicate is an overlap (same path).
        assert!(lf.add("D:/Games/").is_err());
        // Nested-inside is rejected.
        assert!(lf.add("D:/Games/Sub").is_err());
        // Parent-of is rejected.
        assert!(lf.add("D:/").is_err());
        // A genuinely separate root is accepted, and is NOT default.
        lf.add("E:/Library").unwrap();
        assert_eq!(lf.folders.len(), 2);
        assert!(!lf.folders[1].is_default);
    }

    #[test]
    fn add_rejects_empty() {
        let mut lf = LibraryFolders::default();
        assert!(lf.add("   ").is_err());
        assert!(lf.add("").is_err());
    }

    #[test]
    fn set_default_moves_the_flag() {
        let mut lf = LibraryFolders::default();
        lf.add("D:/Games").unwrap();
        lf.add("E:/Library").unwrap();
        lf.set_default("E:/Library").unwrap();
        assert_eq!(lf.default_path(), Some("E:/Library"));
        // Exactly one default.
        assert_eq!(lf.folders.iter().filter(|f| f.is_default).count(), 1);
        // Unknown path errors.
        assert!(lf.set_default("Z:/Nope").is_err());
    }

    #[test]
    fn remove_refuses_default_and_unknown() {
        let mut lf = LibraryFolders::default();
        lf.add("D:/Games").unwrap();
        lf.add("E:/Library").unwrap();
        // D is default → can't remove.
        assert!(lf.remove("D:/Games").is_err());
        // E is removable.
        lf.remove("E:/Library").unwrap();
        assert_eq!(lf.folders.len(), 1);
        // Now-missing path errors.
        assert!(lf.remove("E:/Library").is_err());
    }

    #[test]
    fn ensure_default_seeds_games_dir_for_fresh_user() {
        let mut lf = LibraryFolders::default();
        lf.ensure_default("/data/games");
        assert_eq!(lf.folders.len(), 1);
        assert_eq!(lf.default_path(), Some("/data/games"));
    }

    #[test]
    fn ensure_default_adds_games_dir_keeping_existing_default() {
        let mut lf = LibraryFolders::default();
        lf.add("D:/Games").unwrap(); // becomes default
        lf.ensure_default("/data/games");
        // games dir appended, but D:/Games stays the one default.
        assert_eq!(lf.folders.len(), 2);
        assert_eq!(lf.default_path(), Some("D:/Games"));
        assert!(lf.contains("/data/games"));
    }

    #[test]
    fn ensure_default_collapses_multiple_defaults() {
        let mut lf = LibraryFolders {
            folders: vec![
                LibraryFolder { path: "/data/games".into(), is_default: true },
                LibraryFolder { path: "D:/Games".into(), is_default: true },
            ],
        };
        lf.ensure_default("/data/games");
        assert_eq!(lf.folders.iter().filter(|f| f.is_default).count(), 1);
        assert_eq!(lf.default_path(), Some("/data/games"));
    }
}
