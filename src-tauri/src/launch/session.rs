//! A play session: run the pre-launch hook, spawn the game, then on a background
//! thread wait for it to exit, run the post-exit hook, and emit a `game-exited`
//! event carrying the measured playtime. The frontend listens for that event to
//! update playtime (and later report it to the server). Returns the PID so the
//! UI can show "running" immediately.

use crate::catalog::model::Game;
use crate::error::AppResult;
use crate::launch::{hooks, runner};
use serde::Serialize;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Payload for the `game-exited` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExited {
    pub id: String,
    pub title: String,
    pub playtime_seconds: u64,
    pub exit_ok: bool,
}

pub const GAME_EXITED_EVENT: &str = "game-exited";

/// Wall-clock unix seconds. A clock before the epoch yields 0 rather than
/// panicking — a nonsense stamp is better than killing the exit thread.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Start a play session for `game`. Resolves the launch target, runs the
/// pre-launch hook, spawns the process, and detaches a waiter thread.
pub fn start(app: &AppHandle, mut game: Game) -> AppResult<u32> {
    // For emulator-ROM games the server ships no machine-local launch target;
    // resolve the unpacked emulator exe + installed ROM here. No-op for games
    // that already have a direct target (Steam/Epic/PC), so precedence is intact.
    crate::emulators::launch::enrich(app, &mut game);

    let plan = game.launch_plan().ok_or_else(|| {
        // Re-diagnose for a specific reason instead of a blanket message, so the
        // UI can tell the user *why* (not installed, file moved, etc.).
        let status = crate::launch::target::diagnose(app, &game);
        crate::error::AppError::msg(status.message)
    })?;

    hooks::run(&game.pre_launch_cmd);

    let mut child = runner::spawn(&plan)?;
    let pid = child.id();

    let app = app.clone();
    let id = game.id.clone();
    let title = game.title.clone();
    let post = game.post_exit_cmd.clone();

    std::thread::spawn(move || {
        let started = Instant::now();
        let started_at = unix_now();
        let exit_ok = child.wait().map(|s| s.success()).unwrap_or(false);
        hooks::run(&post);
        let seconds = started.elapsed().as_secs();

        // Record the session before emitting, so history is captured even if no
        // webview is listening. Best-effort: a failed write must never affect
        // the exit path.
        if let Ok(path) = crate::catalog::sessions_commands::sessions_path(&app) {
            let entry = crate::catalog::sessions::PlaySession {
                id: id.clone(),
                title: title.clone(),
                started_at,
                seconds,
            };
            let _ = crate::catalog::sessions::record(&path, entry, unix_now());
        }

        let payload = GameExited {
            id,
            title,
            playtime_seconds: seconds,
            exit_ok,
        };
        let _ = app.emit(GAME_EXITED_EVENT, payload);
    });

    Ok(pid)
}
