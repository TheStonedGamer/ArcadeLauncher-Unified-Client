//! Shared child-process helpers.
//!
//! The launcher is a GUI app, but the shell hooks it spawns are console
//! binaries. Spawning a console-subsystem child from a GUI parent on Windows
//! allocates a new console that flashes in the foreground. [`hide_console`] sets
//! `CREATE_NO_WINDOW` to suppress it (a no-op on other platforms).

use std::process::Command;

/// Suppress the child's console window on Windows. No-op elsewhere.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // winbase.h CREATE_NO_WINDOW — run without allocating a console.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}
