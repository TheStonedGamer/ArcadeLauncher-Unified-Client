//! Where a game's saves actually live on this machine.
//!
//! Cloud sync needs a local folder. Until now that was always the managed
//! `app_data/saves/<id>` directory, which is safe but empty — nothing writes to
//! it, so there was nothing to sync unless the user typed a path by hand. This
//! module supplies the defaults: for emulator games the save directory of the
//! emulator we launch for that platform, and for PC games a best-effort probe of
//! the conventional Windows locations.
//!
//! Everything here is a pure candidate list plus an injected existence
//! predicate, so the platform knowledge is unit-tested without touching disk.
//! Only a candidate that actually exists is ever returned: a guess that isn't
//! there must fall through to the managed folder rather than syncing a path the
//! game never writes.
//!
//! Emulator layouts were verified against real installs where available
//! (Mesen2, PCSX2, Ryujinx, gopher64); the rest follow each emulator's
//! documented default. Both the portable layout (saves next to the executable,
//! which is how our unpacked runtimes are often configured) and the per-user
//! layout are offered, portable first.

use std::path::{Path, PathBuf};

/// The machine's well-known roots. Every field is optional so a missing
/// directory (or a non-Windows host) simply drops the candidates that need it.
#[derive(Debug, Default, Clone)]
pub struct SaveRoots {
    /// The emulator's own directory — the parent of the executable we launch.
    pub emulator_root: Option<PathBuf>,
    /// `%USERPROFILE%\Documents`.
    pub documents: Option<PathBuf>,
    /// `%APPDATA%` (roaming).
    pub roaming: Option<PathBuf>,
    /// `%LOCALAPPDATA%`.
    pub local: Option<PathBuf>,
    /// `%USERPROFILE%\Saved Games`.
    pub saved_games: Option<PathBuf>,
    /// Where this game is installed, for PC games that keep saves alongside.
    pub install_dir: Option<PathBuf>,
}

/// Join `rel` onto `root` when the root is known.
fn under(root: &Option<PathBuf>, rel: &[&str]) -> Option<PathBuf> {
    root.as_ref().map(|r| rel.iter().fold(r.clone(), |acc, part| acc.join(part)))
}

/// Candidate save locations for an emulated platform, most preferred first.
///
/// `xbox` is deliberately absent: xemu keeps game saves inside a multi-gigabyte
/// `xbox_hdd.qcow2` image, so there is no sane directory to sync. Those users
/// need to pick a path explicitly.
pub fn emulator_candidates(platform: &str, roots: &SaveRoots) -> Vec<PathBuf> {
    let emu = &roots.emulator_root;
    let docs = &roots.documents;
    let roaming = &roots.roaming;
    let rel: Vec<Option<PathBuf>> = match platform.to_ascii_lowercase().as_str() {
        // Mesen 2 writes battery saves to `Saves` — portable when a settings
        // file sits beside the exe, else under Documents.
        "nes" | "snes" | "gb" | "gbc" | "gba" => vec![
            under(emu, &["Saves"]),
            under(docs, &["Mesen2", "Saves"]),
        ],
        "n64" => vec![
            under(roaming, &["gopher64", "saves"]),
            under(emu, &["saves"]),
        ],
        "switch" | "ryujinx" => vec![
            under(emu, &["portable", "bis", "user", "save"]),
            under(roaming, &["Ryujinx", "bis", "user", "save"]),
        ],
        // Dolphin splits GameCube memory cards from Wii NAND saves; the shared
        // parent covers both in one sync.
        "gamecube" | "wii" => vec![
            under(emu, &["User", "GC"]),
            under(docs, &["Dolphin Emulator", "GC"]),
        ],
        "xbox360" => vec![under(emu, &["content"])],
        "ps3" => vec![under(emu, &["dev_hdd0", "home", "00000001", "savedata"])],
        "ps2" => vec![
            under(emu, &["memcards"]),
            under(docs, &["PCSX2", "memcards"]),
        ],
        "ps1" | "psx" => vec![
            under(emu, &["memcards"]),
            under(docs, &["DuckStation", "memcards"]),
        ],
        _ => vec![],
    };
    rel.into_iter().flatten().collect()
}

/// Candidate save locations for a PC game, most confident first.
///
/// This is a heuristic and is treated as one: a subdirectory of the install
/// folder is the strongest signal, then a folder named exactly after the game
/// in one of the conventional per-user roots. Anything that doesn't exist is
/// discarded by [`pick_existing`], so a wrong guess costs nothing.
pub fn pc_candidates(title: &str, roots: &SaveRoots) -> Vec<PathBuf> {
    let name = title.trim();
    if name.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<PathBuf> = Vec::new();
    // Saves kept inside the install folder (common for indie and older games).
    for sub in ["Saves", "Save", "SaveGames", "savegame", "SaveData", "saves"] {
        out.extend(under(&roots.install_dir, &[sub]));
    }
    // The conventional per-user locations, keyed by the exact game name.
    out.extend(under(&roots.documents, &["My Games", name]));
    out.extend(under(&roots.saved_games, &[name]));
    out.extend(under(&roots.documents, &[name]));
    out.extend(under(&roots.roaming, &[name]));
    out.extend(under(&roots.local, &[name]));
    out
}

/// The first candidate that exists, per the injected predicate. Pure so the
/// ordering is testable; callers pass `|p| p.exists()`.
pub fn pick_existing(candidates: &[PathBuf], exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates.iter().find(|p| exists(p)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> SaveRoots {
        SaveRoots {
            emulator_root: Some(PathBuf::from("/emu/Mesen")),
            documents: Some(PathBuf::from("/home/docs")),
            roaming: Some(PathBuf::from("/home/roaming")),
            local: Some(PathBuf::from("/home/local")),
            saved_games: Some(PathBuf::from("/home/SavedGames")),
            install_dir: Some(PathBuf::from("/games/Title")),
        }
    }

    #[test]
    fn mesen_prefers_portable_then_documents() {
        let c = emulator_candidates("snes", &roots());
        assert_eq!(c[0], PathBuf::from("/emu/Mesen/Saves"));
        assert_eq!(c[1], PathBuf::from("/home/docs/Mesen2/Saves"));
    }

    #[test]
    fn every_emulated_platform_from_exe_candidates_has_a_default() {
        // Keep this list in step with launch::exe_candidates. `xbox` (xemu) is
        // the documented exception — its saves live inside a disk image.
        for p in ["nes", "snes", "gb", "gbc", "gba", "n64", "switch", "gamecube", "wii", "xbox360", "ps3", "ps2", "ps1"] {
            assert!(!emulator_candidates(p, &roots()).is_empty(), "no default for {p}");
        }
        assert!(emulator_candidates("xbox", &roots()).is_empty());
    }

    #[test]
    fn unknown_platform_has_no_candidates() {
        assert!(emulator_candidates("steam", &roots()).is_empty());
        assert!(emulator_candidates("", &roots()).is_empty());
    }

    #[test]
    fn platform_match_is_case_insensitive() {
        assert_eq!(emulator_candidates("GameCube", &roots()), emulator_candidates("gamecube", &roots()));
    }

    #[test]
    fn missing_roots_drop_their_candidates() {
        let sparse = SaveRoots { documents: Some(PathBuf::from("/home/docs")), ..Default::default() };
        // Only the Documents candidate survives when there is no emulator dir.
        assert_eq!(emulator_candidates("ps2", &sparse), vec![PathBuf::from("/home/docs/PCSX2/memcards")]);
        assert!(emulator_candidates("xbox360", &sparse).is_empty());
    }

    #[test]
    fn pc_candidates_lead_with_the_install_folder() {
        let c = pc_candidates("Title", &roots());
        assert_eq!(c[0], PathBuf::from("/games/Title/Saves"));
        assert!(c.contains(&PathBuf::from("/home/docs/My Games/Title")));
        assert!(c.contains(&PathBuf::from("/home/SavedGames/Title")));
        assert!(c.contains(&PathBuf::from("/home/roaming/Title")));
    }

    #[test]
    fn pc_candidates_need_a_title() {
        assert!(pc_candidates("   ", &roots()).is_empty());
    }

    #[test]
    fn pick_existing_returns_the_first_hit_in_order() {
        let c = vec![PathBuf::from("/a"), PathBuf::from("/b"), PathBuf::from("/c")];
        let hit = pick_existing(&c, |p| p == Path::new("/b") || p == Path::new("/c"));
        assert_eq!(hit, Some(PathBuf::from("/b")));
        assert_eq!(pick_existing(&c, |_| false), None);
    }
}
