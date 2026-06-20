//! "Is the launcher already running?" detection for the bootstrap updater.
//!
//! The updater is the entry point: it normally checks for an update, applies it,
//! then launches the app. But if the user re-runs it while the launcher is
//! already open, applying an update would mean reinstalling *over a running app*
//! (file locks on Windows, a clobbered AppImage on Linux). Instead we detect the
//! running launcher and simply surface its window — spawning the app makes the
//! launcher's single-instance guard bring the existing window to the front, then
//! the duplicate exits. Detection is by process enumeration via `sysinfo`, which
//! is pure Rust and behaves identically on Windows and Linux (no system deps).

/// Executable names the installed launcher may run as, per OS. The updater's own
/// binary (`updater` / `updater.exe`) is deliberately absent so we never mistake
/// ourselves for the launcher.
pub fn launcher_process_names() -> &'static [&'static str] {
    if cfg!(target_os = "windows") {
        &["ArcadeLauncher.exe", "arcade_launcher.exe"]
    } else {
        &["arcade-launcher", "arcade_launcher", "ArcadeLauncher"]
    }
}

/// Pure predicate: does any observed process identifier match a launcher binary
/// name (case-insensitive, exact)? `observed` holds the process names and exe
/// basenames gathered from the OS. Kept pure + unit-tested so the matching never
/// silently breaks when a binary is renamed.
pub fn matches_launcher(observed: &[String]) -> bool {
    let names = launcher_process_names();
    observed
        .iter()
        .any(|o| names.iter().any(|n| o.eq_ignore_ascii_case(n)))
}

/// Thin OS seam: true when a launcher process is currently running. Collects
/// each process's reported name *and* its executable basename (the Linux `name`
/// can be truncated to 15 chars, so the exe basename is the reliable signal) and
/// runs them through the pure [`matches_launcher`] predicate.
pub fn launcher_is_running() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_exe(UpdateKind::Always),
    );

    let observed: Vec<String> = sys
        .processes()
        .values()
        .flat_map(|p| {
            let mut ids = vec![p.name().to_string_lossy().into_owned()];
            if let Some(name) = p.exe().and_then(|e| e.file_name()) {
                ids.push(name.to_string_lossy().into_owned());
            }
            ids
        })
        .collect();

    matches_launcher(&observed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_every_known_launcher_name_case_insensitively() {
        for name in launcher_process_names() {
            assert!(matches_launcher(&[name.to_string()]), "exact: {name}");
            assert!(matches_launcher(&[name.to_uppercase()]), "upper: {name}");
            assert!(matches_launcher(&[name.to_lowercase()]), "lower: {name}");
        }
    }

    #[test]
    fn ignores_unrelated_and_updater_processes() {
        assert!(!matches_launcher(&[]));
        assert!(!matches_launcher(&["updater".into(), "updater.exe".into()]));
        assert!(!matches_launcher(&["explorer.exe".into(), "bash".into()]));
        // A partial / prefixed name must not match — exact only.
        let probe = format!("{}Setup", launcher_process_names()[0]);
        assert!(!matches_launcher(&[probe]));
    }
}
