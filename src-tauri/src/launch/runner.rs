//! Spawns a game process from a resolved `LaunchPlan`. Cross-platform via
//! `std::process::Command`. Returns the live `Child` so the caller (session)
//! can wait on it for playtime tracking.

use crate::catalog::model::LaunchPlan;
use crate::error::{AppError, AppResult};
use std::path::Path;
use std::process::{Child, Command};

/// A launch target that isn't a local filesystem path — a protocol/URI handler
/// like `steam://run/220`. Must match `launch::target::is_uri_target`: a Windows
/// drive path contains a colon but not the `://` scheme separator.
fn is_uri(program: &str) -> bool {
    program.contains("://")
}

/// Build the command that hands a URI to the OS protocol handler. `Command::new`
/// can only exec a real binary, so a `steam://` / `com.epicgames.launcher://`
/// target has to go through the platform's opener instead.
fn uri_command(uri: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        // `start` is a cmd builtin, not an exe. The empty "" is the window title
        // argument — without it `start` treats the URI as the title and opens a
        // blank console instead of launching anything.
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", uri]);
        c
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = Command::new("open");
        c.arg(uri);
        c
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let mut c = Command::new("xdg-open");
        c.arg(uri);
        c
    }
}

/// Launch the program described by `plan`, returning the child handle.
pub fn spawn(plan: &LaunchPlan) -> AppResult<Child> {
    let program = plan.program.trim();
    if program.is_empty() {
        return Err(AppError::msg("game has no launch target"));
    }

    let mut cmd = if is_uri(program) {
        uri_command(program)
    } else {
        let mut c = Command::new(program);
        c.args(&plan.args);
        // Games and emulators routinely resolve their data files relative to the
        // working directory; inheriting the launcher's cwd makes many of them
        // fail on startup. Run them from their own folder.
        if let Some(dir) = Path::new(program).parent().filter(|d| !d.as_os_str().is_empty()) {
            c.current_dir(dir);
        }
        c
    };

    cmd.spawn()
        .map_err(|e| AppError::msg(format!("failed to launch '{}': {e}", plan.program)))
}
