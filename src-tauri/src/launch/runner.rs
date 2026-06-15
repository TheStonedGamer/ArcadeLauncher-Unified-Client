//! Spawns a game process from a resolved `LaunchPlan`. Cross-platform: the same
//! code path runs on Windows and Linux because `std::process::Command` abstracts
//! the OS. The child is detached — we don't wait on it (playtime tracking that
//! does wait comes in a later phase).

use crate::catalog::model::LaunchPlan;
use crate::error::{AppError, AppResult};
use std::process::Command;

/// Launch the program described by `plan`. Returns the child PID on success.
pub fn spawn(plan: &LaunchPlan) -> AppResult<u32> {
    if plan.program.trim().is_empty() {
        return Err(AppError::msg("game has no launch target"));
    }
    let child = Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map_err(|e| AppError::msg(format!("failed to launch '{}': {e}", plan.program)))?;
    Ok(child.id())
}
