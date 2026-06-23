//! Shared child-process helpers.
//!
//! Two cross-cutting concerns for every helper/sidecar we spawn:
//!  1. **No stray console window.** The launcher is a GUI app, but the stream
//!     engine, the shell hooks, and the mesh CLIs are console binaries. Spawning
//!     a console subsystem child from a GUI parent on Windows allocates a new
//!     console that flashes in the foreground. [`hide_console`] sets
//!     `CREATE_NO_WINDOW` to suppress it (a no-op on other platforms).
//!  2. **Diagnosable logs.** The engine otherwise runs with its stdio sent to
//!     the null device, so a stream/host failure leaves no trail. [`log_stdio`]
//!     tees a child's output to a named file under the app log dir (Moonlight =
//!     `stream` mode, the Sunshine host driver = `host` mode), which is what made
//!     the silent `not_paired` window-flash impossible to diagnose before.
//!
//! The log dir is captured once at startup ([`set_log_dir`]) into a process
//! global so spawn helpers don't need an `AppHandle` threaded through every
//! caller (the engine spawn sites are deep, handle-free free functions).

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// App log directory, resolved once from the Tauri path API during `setup`.
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record the app log directory (call once at startup). Best-effort: ensures the
/// directory exists so later [`log_stdio`] opens succeed.
pub fn set_log_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir);
}

/// Suppress the child's console window on Windows. No-op elsewhere.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // winbase.h CREATE_NO_WINDOW — run without allocating a console.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// An appending [`Stdio`] writing to `<log_dir>/<name>`, for capturing a child's
/// stdout/stderr. Falls back to [`Stdio::null`] if the log dir is unset (e.g. a
/// spawn before `setup`) or the file can't be opened, so a logging hiccup never
/// blocks a spawn.
pub fn log_stdio(name: &str) -> Stdio {
    if let Some(dir) = LOG_DIR.get() {
        if let Ok(f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(name))
        {
            return Stdio::from(f);
        }
    }
    Stdio::null()
}
