//! One-time, best-effort migration of installed game folders from the legacy
//! id-named scheme (`games/pc-fdc100f88077`) to clean, title-named folders
//! (`games/Food Delivery Simulator`). Runs once at startup. The install records
//! file is the source of truth for where a game lives, so renaming a folder and
//! updating its record makes launch resolution (`resolve_install_dir`) follow
//! automatically. Anything locked, missing, already migrated, or colliding with
//! an existing folder is skipped — the migration must never be fatal and must
//! never clobber data.

use std::path::{Path, PathBuf};

use crate::catalog::model::Game;
use crate::download::paths;
use crate::download::records::{self, InstallState};

/// Rename id-named install folders to clean-title folders and update the install
/// records to match. Returns human-readable log lines (one per game acted on or
/// skipped-with-reason) for the caller to print. Best-effort throughout: any
/// single failure is logged and skipped, never propagated.
pub fn migrate_install_dirs(games_root: &Path, records_path: &Path, catalog: &[Game]) -> Vec<String> {
    let mut log = Vec::new();
    let mut recs = match records::load(records_path) {
        Ok(r) => r,
        Err(e) => {
            log.push(format!("skip: cannot read records: {e}"));
            return log;
        }
    };

    // id → clean title from the locally-cached catalog (offline, no network).
    let title_of = |id: &str| -> Option<String> {
        catalog
            .iter()
            .find(|g| g.id == id)
            .map(|g| g.title.clone())
            .filter(|t| !t.trim().is_empty())
    };

    // Only on-disk installs are migrated; in-flight / failed / paused records are
    // left exactly where they are. Snapshot the ids so we can mutate `recs`.
    let ids: Vec<String> = recs
        .records
        .values()
        .filter(|r| matches!(r.state, InstallState::Installed | InstallState::UpdateAvailable))
        .map(|r| r.game_id.clone())
        .collect();

    let mut changed = false;
    for id in ids {
        let current = match recs.get(&id) {
            Some(r) if !r.install_dir.is_empty() => PathBuf::from(&r.install_dir),
            // No recorded dir → assume the legacy id-named location.
            Some(_) => games_root.join(&id),
            None => continue,
        };

        let title = match title_of(&id) {
            Some(t) => t,
            None => continue, // no catalog title yet — leave it on the id scheme
        };

        // Where it *should* live, disambiguated against every other record's dir
        // and anything already on disk — but never against its own current dir.
        let desired = paths::unique_install_dir(games_root, &id, &title, |cand| {
            cand != current.as_path()
                && (cand.exists()
                    || recs
                        .records
                        .values()
                        .any(|r| r.game_id != id && Path::new(&r.install_dir) == cand))
        });

        if desired == current {
            continue; // already correctly named
        }
        if !current.exists() {
            continue; // recorded installed but folder is gone — don't fabricate a move
        }
        if desired.exists() {
            log.push(format!("{id}: target exists, left in place ({})", desired.display()));
            continue;
        }
        match std::fs::rename(&current, &desired) {
            Ok(()) => {
                if let Some(rec) = recs.records.get_mut(&id) {
                    rec.install_dir = desired.to_string_lossy().into_owned();
                    changed = true;
                }
                log.push(format!("{id}: {} -> {}", current.display(), desired.display()));
            }
            Err(e) => {
                // Locked / in use / permission — best-effort, skip it this run.
                log.push(format!("{id}: rename failed ({e}), left in place"));
            }
        }
    }

    if changed {
        if let Err(e) = records::save(records_path, &recs) {
            log.push(format!("records save failed: {e}"));
        }
    }
    log
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::download::records::InstallRecord;

    fn game(id: &str, title: &str) -> Game {
        Game { id: id.into(), title: title.into(), ..Default::default() }
    }

    fn installed(id: &str, dir: &Path) -> InstallRecord {
        InstallRecord {
            game_id: id.into(),
            state: InstallState::Installed,
            install_dir: dir.to_string_lossy().into_owned(),
            ..Default::default()
        }
    }

    fn temp_root(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_migrate_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn renames_id_folder_to_clean_title_and_updates_record() {
        let root = temp_root("rename");
        let games = root.join("games");
        let old = games.join("pc-abc123");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("game.exe"), b"x").unwrap();

        let records_path = root.join("install_records.json");
        let mut recs = records::InstallRecords::default();
        recs.upsert(installed("pc-abc123", &old));
        records::save(&records_path, &recs).unwrap();

        let log = migrate_install_dirs(&games, &records_path, &[game("pc-abc123", "Cool Game")]);
        assert_eq!(log.len(), 1, "{log:?}");

        let want = games.join("Cool Game");
        assert!(want.join("game.exe").exists(), "files moved");
        assert!(!old.exists(), "old folder gone");

        let after = records::load(&records_path).unwrap();
        assert_eq!(after.get("pc-abc123").unwrap().install_dir, want.to_string_lossy());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_when_target_exists() {
        let root = temp_root("collision");
        let games = root.join("games");
        let old = games.join("pc-abc123");
        let blocker = games.join("Cool Game");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&blocker).unwrap();

        let records_path = root.join("install_records.json");
        let mut recs = records::InstallRecords::default();
        recs.upsert(installed("pc-abc123", &old));
        records::save(&records_path, &recs).unwrap();

        let log = migrate_install_dirs(&games, &records_path, &[game("pc-abc123", "Cool Game")]);
        // Disambiguated to "Cool Game (abc123)" since the clean name is taken.
        assert!(old.exists() == false || games.join("Cool Game (abc123)").exists());
        assert_eq!(log.len(), 1, "{log:?}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn already_clean_is_noop() {
        let root = temp_root("noop");
        let games = root.join("games");
        let clean = games.join("Cool Game");
        std::fs::create_dir_all(&clean).unwrap();

        let records_path = root.join("install_records.json");
        let mut recs = records::InstallRecords::default();
        recs.upsert(installed("pc-abc123", &clean));
        records::save(&records_path, &recs).unwrap();

        let log = migrate_install_dirs(&games, &records_path, &[game("pc-abc123", "Cool Game")]);
        assert!(log.is_empty(), "{log:?}");
        assert!(clean.exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
