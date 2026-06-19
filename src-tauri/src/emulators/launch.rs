//! Resolve an emulator-ROM game into a runnable launch target.
//!
//! Server `emulator_rom` games arrive with a `platform` (NES, GameCube, Xbox…)
//! and an `arguments` template (`{rom}` placeholder) but no `emulator_path` /
//! `rom_path` — those are machine-local. At launch time we fill them in:
//!
//!   * `emulator_path` ← the emulator executable inside an unpacked runtime dir
//!     (`<app_data>/emulators/_runtimes/<id>/…`), located by candidate exe name
//!     for the game's platform. We search across ALL runtime dirs rather than
//!     coupling to the server's emulator id, so a renamed archive still resolves.
//!   * `rom_path` ← the installed ROM file under the game's install dir
//!     (`<app_data>/games/<id>`), recorded in `install_records.json`.
//!
//! With both filled, `Game::launch_plan` substitutes `{rom}` and spawns. If we
//! can't resolve an emulator or ROM we leave the game untouched, so a directly
//! runnable entry (exe/launchUri) still launches via the normal precedence.

use crate::catalog::model::Game;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Candidate executable names (case-insensitive) for a platform's emulator, most
/// specific first. Returns an empty slice for platforms we don't emulate (Steam,
/// Epic, PC) so those fall through to their own launch target untouched.
pub(crate) fn exe_candidates(platform: &str) -> &'static [&'static str] {
    match platform.to_ascii_lowercase().as_str() {
        // Nintendo handhelds/consoles via Mesen (NES/SNES/GB/GBC/GBA…).
        "nes" | "snes" | "gb" | "gbc" | "gba" => &["Mesen.exe"],
        "n64" => &["gopher64-windows-x86_64.exe", "gopher64.exe"],
        "switch" | "ryujinx" => &["Ryujinx.exe", "Ryujinx.Ava.exe", "Ryujinx.Headless.SDL2.exe"],
        "gamecube" | "wii" => &["Dolphin.exe", "DolphinWx.exe"],
        "xbox360" => &["xenia_canary.exe", "xenia.exe"],
        "xbox" => &["xemu.exe"],
        // PlayStation (no server scanners yet, but runtimes are hosted — wire the
        // exe names now so adding the scanners is the only remaining step).
        "ps3" => &["rpcs3.exe"],
        "ps2" => &["pcsx2-qt.exe", "pcsx2.exe"],
        "ps1" | "psx" => &["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe", "duckstation.exe"],
        _ => &[],
    }
}

/// The local emulators dir (`<app_data>/emulators`), mirroring `commands.rs`.
pub(crate) fn emulators_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("emulators"))
}

/// Find an executable named like one of `candidates` anywhere under the unpacked
/// runtimes root (`<emulators>/_runtimes`). Candidates are tried in order, and
/// for each we walk every runtime dir, so the most-preferred exe wins even if a
/// less-preferred one sorts earlier on disk.
pub(crate) fn find_exe(runtimes_root: &Path, candidates: &[&str]) -> Option<PathBuf> {
    for want in candidates {
        if let Some(hit) = walk_for(runtimes_root, &want.to_ascii_lowercase(), 6) {
            return Some(hit);
        }
    }
    None
}

/// Depth-limited search for a file whose name equals `want_lower` (lowercased).
fn walk_for(dir: &Path, want_lower: &str, depth: u32) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            subdirs.push(path);
        } else if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            if name.to_ascii_lowercase() == want_lower {
                return Some(path);
            }
        }
    }
    if depth == 0 {
        return None;
    }
    for sub in subdirs {
        if let Some(hit) = walk_for(&sub, want_lower, depth - 1) {
            return Some(hit);
        }
    }
    None
}

/// The installed ROM file for a game, given its install dir. ROM installs drop a
/// single file (the ROM/ISO); when several files exist we take the largest,
/// which is the disc/cart image rather than a sidecar (`.txt`, checksum, etc.).
/// Hidden/`.part` files are ignored.
fn find_rom(install_dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(install_dir).ok()?.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') || name.ends_with(".part") {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if best.as_ref().map(|(b, _)| size > *b).unwrap_or(true) {
            best = Some((size, path));
        }
    }
    best.map(|(_, p)| p)
}

/// Why `enrich` did (or didn't) fill in an emulator-ROM launch target. The
/// distinct skip reasons let the caller surface a precise "why it can't run"
/// instead of a blanket "no runnable target" (see `launch::target::diagnose`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnrichOutcome {
    /// Filled the target, already had a direct one, or the platform isn't
    /// emulated — either way the normal launch precedence applies as-is.
    Resolved,
    /// Emulator-ROM platform, but no unpacked emulator runtime is installed.
    EmulatorMissing,
    /// Emulator runtime present, but the game's ROM/ISO isn't installed.
    RomMissing,
}

/// Fill `game.emulator_path` / `game.rom_path` for an emulator-ROM game so it can
/// launch. No-op (leaves the game unchanged) when the platform isn't emulated,
/// the game already has a direct launch target, no runtime exe is present, or the
/// ROM isn't installed — callers fall back to the normal launch precedence.
pub fn enrich(app: &tauri::AppHandle, game: &mut Game) {
    let _ = enrich_status(app, game);
}

/// Like [`enrich`], but reports the outcome so a caller can tell a genuinely
/// unconfigured game (`Resolved` + no other target → "no target") apart from an
/// emulator game that's simply not installed yet (`EmulatorMissing`/`RomMissing`).
pub fn enrich_status(app: &tauri::AppHandle, game: &mut Game) -> EnrichOutcome {
    // Already directly runnable, or already resolved — nothing to do.
    if !game.launch_uri.is_empty() || !game.emulator_path.is_empty() {
        return EnrichOutcome::Resolved;
    }
    let candidates = exe_candidates(&game.platform);
    if candidates.is_empty() {
        // Not an emulated platform — leave it to the exe/uri precedence.
        return EnrichOutcome::Resolved;
    }
    let Some(emu_dir) = emulators_dir(app) else {
        return EnrichOutcome::EmulatorMissing;
    };
    let Some(exe) = find_exe(&emu_dir.join("_runtimes"), candidates) else {
        return EnrichOutcome::EmulatorMissing;
    };

    // Resolve the installed ROM via the install record's dir, falling back to the
    // conventional `<app_data>/games/<id>` layout if the record lacks a dir.
    let install_dir = resolve_install_dir(app, &game.id);
    let Some(rom) = install_dir.as_deref().and_then(find_rom) else {
        return EnrichOutcome::RomMissing;
    };

    game.emulator_path = exe.to_string_lossy().into_owned();
    game.rom_path = rom.to_string_lossy().into_owned();
    EnrichOutcome::Resolved
}

/// The install dir for `game_id` from `install_records.json`, or the conventional
/// `<app_data>/games/<id>` path when unrecorded.
fn resolve_install_dir(app: &tauri::AppHandle, game_id: &str) -> Option<PathBuf> {
    if let Ok(config_dir) = app.path().app_config_dir() {
        let recs = crate::download::records::load(&config_dir.join("install_records.json"))
            .unwrap_or_default();
        if let Some(rec) = recs.get(game_id) {
            if !rec.install_dir.is_empty() {
                return Some(PathBuf::from(&rec.install_dir));
            }
        }
    }
    app.path().app_data_dir().ok().map(|d| d.join("games").join(game_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_candidates_cover_known_consoles() {
        assert_eq!(exe_candidates("GameCube"), &["Dolphin.exe", "DolphinWx.exe"]);
        assert_eq!(exe_candidates("wii"), &["Dolphin.exe", "DolphinWx.exe"]);
        assert!(exe_candidates("Xbox").contains(&"xemu.exe"));
        assert!(exe_candidates("Switch").contains(&"Ryujinx.exe"));
        assert!(exe_candidates("NES").contains(&"Mesen.exe"));
        // Unemulated platforms resolve to nothing.
        assert!(exe_candidates("Steam").is_empty());
        assert!(exe_candidates("PC").is_empty());
    }

    #[test]
    fn find_exe_locates_nested_executable() {
        let dir = std::env::temp_dir().join(format!("emu_launch_test_{}", std::process::id()));
        let nested = dir.join("ryujinx").join("publish");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("Ryujinx.exe"), b"x").unwrap();
        std::fs::write(dir.join("readme.txt"), b"x").unwrap();

        let hit = find_exe(&dir, &["Ryujinx.exe"]).unwrap();
        assert!(hit.ends_with("Ryujinx.exe"));
        // Case-insensitive match.
        assert!(find_exe(&dir, &["ryujinx.exe"]).is_some());
        assert!(find_exe(&dir, &["Dolphin.exe"]).is_none());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn find_rom_picks_largest_file() {
        let dir = std::env::temp_dir().join(format!("rom_test_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("game.iso"), vec![0u8; 4096]).unwrap();
        std::fs::write(dir.join("notes.txt"), b"small").unwrap();
        std::fs::write(dir.join(".hidden"), vec![0u8; 8192]).unwrap();

        let rom = find_rom(&dir).unwrap();
        assert!(rom.ends_with("game.iso"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
