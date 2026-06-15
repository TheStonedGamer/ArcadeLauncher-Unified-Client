//! Tauri commands for launching games.

use crate::catalog::model::Game;
use crate::error::{AppError, AppResult};
use crate::launch::runner;

/// Launch a game. The frontend sends the full `Game` it already holds, so T0
/// needs no server round-trip. Returns the spawned PID.
#[tauri::command]
pub fn launch_game(game: Game) -> AppResult<u32> {
    let plan = game
        .launch_plan()
        .ok_or_else(|| AppError::msg(format!("'{}' has no runnable target", game.title)))?;
    runner::spawn(&plan)
}
