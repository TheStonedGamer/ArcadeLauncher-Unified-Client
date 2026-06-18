//! Diagnose whether a game can run, and if not, *why* — so the UI and launch
//! errors report a specific reason ("emulator not installed", "ROM not
//! installed", "file moved or drive removed") instead of a blanket
//! "No Runnable Target". This is what eliminates the false/confusing
//! no-runnable-target reports: most of those are really not-installed-yet or
//! moved-file cases, and now we say so.

use crate::catalog::model::Game;
use crate::emulators::launch::{enrich_status, EnrichOutcome};
use std::path::Path;

/// The runnability verdict for a game, with a machine-readable `kind` and a
/// human `message`. Serialized to the webview by the `check_runnable` command.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStatus {
    /// Whether the game can be launched right now.
    pub runnable: bool,
    /// Stable discriminant: `runnable` | `emulatorMissing` | `romMissing` |
    /// `executableMissing` | `noTarget`.
    pub kind: String,
    /// User-facing explanation (and, for runnable, the resolved program).
    pub message: String,
}

impl TargetStatus {
    fn ok(program: &str) -> Self {
        Self { runnable: true, kind: "runnable".into(), message: program.into() }
    }
    fn broken(kind: &str, message: String) -> Self {
        Self { runnable: false, kind: kind.into(), message }
    }
}

/// A launch target that isn't a local filesystem path — a protocol/URI handler
/// like `steam://run/220` or `com.epicgames.launcher://...`. We can't (and
/// shouldn't) stat these; they're considered runnable if configured.
fn is_uri_target(program: &str) -> bool {
    // A Windows drive path ("C:\..." / "C:/...") is NOT a URI even though it
    // contains a colon, so require the "://" scheme separator.
    program.contains("://")
}

/// Diagnose `game` after running emulator enrichment. `exists` decides whether a
/// resolved local program path is present — injected so the core logic is pure
/// and unit-testable; production passes `Path::exists`.
fn classify(game: &Game, outcome: EnrichOutcome, exists: impl Fn(&str) -> bool) -> TargetStatus {
    match outcome {
        EnrichOutcome::EmulatorMissing => {
            return TargetStatus::broken(
                "emulatorMissing",
                format!("The {} emulator isn't installed yet.", game.platform),
            );
        }
        EnrichOutcome::RomMissing => {
            return TargetStatus::broken(
                "romMissing",
                format!("\"{}\" isn't installed yet.", game.title),
            );
        }
        EnrichOutcome::Resolved => {}
    }

    match game.launch_plan() {
        None => TargetStatus::broken(
            "noTarget",
            "No launch target is configured for this game.".into(),
        ),
        Some(plan) => {
            if !is_uri_target(&plan.program) && !exists(&plan.program) {
                TargetStatus::broken(
                    "executableMissing",
                    format!("The game's file is missing (moved, uninstalled, or on a removed drive):\n{}", plan.program),
                )
            } else {
                TargetStatus::ok(&plan.program)
            }
        }
    }
}

/// Diagnose `game` against the real filesystem. Clones the game so enrichment
/// (which fills emulator/ROM paths) doesn't mutate the caller's copy.
pub fn diagnose(app: &tauri::AppHandle, game: &Game) -> TargetStatus {
    let mut g = game.clone();
    let outcome = enrich_status(app, &mut g);
    classify(&g, outcome, |p| Path::new(p).exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game_with_exe(exe: &str) -> Game {
        Game { exe_path: exe.into(), title: "Test".into(), ..Default::default() }
    }

    #[test]
    fn uri_target_is_runnable_without_stat() {
        let g = Game { launch_uri: "steam://run/220".into(), ..Default::default() };
        // exists() always false — a URI must still be runnable.
        let s = classify(&g, EnrichOutcome::Resolved, |_| false);
        assert!(s.runnable);
        assert_eq!(s.kind, "runnable");
    }

    #[test]
    fn windows_path_is_not_mistaken_for_uri() {
        let g = game_with_exe("C:/Games/halo.exe");
        let present = classify(&g, EnrichOutcome::Resolved, |_| true);
        assert!(present.runnable);
        let missing = classify(&g, EnrichOutcome::Resolved, |_| false);
        assert!(!missing.runnable);
        assert_eq!(missing.kind, "executableMissing");
    }

    #[test]
    fn emulator_missing_is_specific() {
        let g = Game { platform: "GameCube".into(), ..Default::default() };
        let s = classify(&g, EnrichOutcome::EmulatorMissing, |_| false);
        assert!(!s.runnable);
        assert_eq!(s.kind, "emulatorMissing");
        assert!(s.message.contains("GameCube"));
    }

    #[test]
    fn rom_missing_is_specific() {
        let g = Game { title: "Crystalis".into(), platform: "NES".into(), ..Default::default() };
        let s = classify(&g, EnrichOutcome::RomMissing, |_| false);
        assert!(!s.runnable);
        assert_eq!(s.kind, "romMissing");
        assert!(s.message.contains("Crystalis"));
    }

    #[test]
    fn no_fields_is_no_target() {
        let s = classify(&Game::default(), EnrichOutcome::Resolved, |_| true);
        assert!(!s.runnable);
        assert_eq!(s.kind, "noTarget");
    }
}
