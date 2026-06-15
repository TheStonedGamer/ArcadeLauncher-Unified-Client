//! Pre-launch / post-exit shell hooks (Playnite-style). Each runs through the
//! platform shell, blocking until it finishes, and any failure is intentionally
//! ignored — a broken hook must never stop the game from launching or the app
//! from continuing. Empty commands are no-ops.

use std::process::Command;

/// Run `cmd` through the OS shell and wait for it. Errors are swallowed.
pub fn run(cmd: &str) {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return;
    }
    let mut shell = shell();
    let _ = shell.arg(cmd).status();
}

#[cfg(windows)]
fn shell() -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C");
    c
}

#[cfg(not(windows))]
fn shell() -> Command {
    let mut c = Command::new("sh");
    c.arg("-c");
    c
}
