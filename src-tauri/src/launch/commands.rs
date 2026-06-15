//! Tauri commands for launching games.

use crate::catalog::model::Game;
use crate::error::AppResult;
use crate::launch::session;

/// Launch a game (runs pre/post hooks + tracks playtime via a `game-exited`
/// event). The frontend sends the full `Game`. Returns the spawned PID.
#[tauri::command]
pub fn launch_game(app: tauri::AppHandle, game: Game) -> AppResult<u32> {
    session::start(&app, game)
}
