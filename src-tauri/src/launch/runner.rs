//! Spawns a game process from a resolved `LaunchPlan`. Cross-platform via
//! `std::process::Command`. Returns the live `Child` so the caller (session)
//! can wait on it for playtime tracking.

use crate::catalog::model::LaunchPlan;
use crate::error::{AppError, AppResult};
use std::process::{Child, Command};

/// Launch the program described by `plan`, returning the child handle.
pub fn spawn(plan: &LaunchPlan) -> AppResult<Child> {
    if plan.program.trim().is_empty() {
        return Err(AppError::msg("game has no launch target"));
    }
    Command::new(&plan.program)
        .args(&plan.args)
        .spawn()
        .map_err(|e| AppError::msg(format!("failed to launch '{}': {e}", plan.program)))
}
