//! Tauri commands for launching games.

use crate::catalog::model::Game;
use crate::error::AppResult;
use crate::launch::{session, target};

/// Launch a game (runs pre/post hooks + tracks playtime via a `game-exited`
/// event). The frontend sends the full `Game`. Returns the spawned PID.
#[tauri::command]
pub fn launch_game(app: tauri::AppHandle, game: Game) -> AppResult<u32> {
    session::start(&app, game)
}

/// Diagnose whether a game can run right now, and if not, why. Lets the UI label
/// a game's launch readiness (and show a precise reason) without attempting to
/// spawn it. Never errors — an unrunnable game is a successful diagnosis.
#[tauri::command]
pub fn check_runnable(app: tauri::AppHandle, game: Game) -> target::TargetStatus {
    target::diagnose(&app, &game)
}
