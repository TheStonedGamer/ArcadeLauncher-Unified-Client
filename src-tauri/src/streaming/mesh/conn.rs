//! Mesh transport (T12k-8): drive the **bundled** Tailscale to join the
//! self-hosted Headscale overlay, so a remote host's `100.64.x.x` mesh IP
//! becomes dialable by the existing streaming flow. There is never a separate
//! user-facing Tailscale install — `tailscaled`/`tailscale` ship in the
//! installer next to the stream engine and are located the same way
//! (`engine_conn::engine_path`): a dev override dir, else next to our own exe.
//!
//! We drive the **CLI** (`tailscale up`, `tailscale status --json`) rather than
//! hand-rolling the LocalAPI: the CLI talks to `tailscaled` for us, and the
//! argv + status parsing already live in the pure [`control`] core, so this
//! file is only process IO. The `tailscale up` argv comes straight from
//! [`UpArgs::cli_args`]; status JSON is parsed by [`control::parse_self_mesh_ip`]
//! / [`control::peer_mesh_ip`].
//!
//! **Privileged daemon bring-up (Windows = one-time service install).** Creating
//! the WinTun adapter needs Administrator. Rather than re-elevating every session,
//! [`join`] installs the bundled `tailscaled` as an **auto-start LocalSystem
//! Windows service** (`tailscaled install-system-daemon` + an explicit
//! `Start-Service` — install alone leaves it Stopped) on first use, a single UAC
//! accept. The `tailscale up` join itself, and every later `status`/`set`/
//! `resolve`, then run **unprivileged** from the launcher: on Windows the running
//! LocalSystem daemon grants the interactive user LocalAPI access with no
//! `--operator` (verified on real hardware), so no auth key or operator name ever
//! passes through the elevated batch. Because the service is auto-start, the mesh
//! survives reboots and [`join`]'s fast path skips elevation on every later
//! session. Linux keeps the unprivileged [`ensure_daemon`] spawn (needs
//! `/dev/net/tun`). ⚠️ Still wants a two-machine real-hardware pass (T12k-8 gate 3)
//! to confirm the cross-internet WinTun A/V stream actually connects.

use crate::error::{AppError, AppResult};
use crate::streaming::mesh::control::{self, MeshPhase, MeshState, UpArgs};
use std::path::PathBuf;
use std::process::{Command, Stdio};

const DAEMON_BIN: &str = if cfg!(windows) { "tailscaled.exe" } else { "tailscaled" };
const CLI_BIN: &str = if cfg!(windows) { "tailscale.exe" } else { "tailscale" };

/// Locate a bundled Tailscale binary: dev override (`ARCADE_TAILSCALE_DIR`)
/// first, then next to our own exe (the release sidecar location).
fn mesh_bin(name: &str) -> AppResult<PathBuf> {
    if let Ok(dir) = std::env::var("ARCADE_TAILSCALE_DIR") {
        let p = PathBuf::from(dir).join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(cand) = exe.parent().map(|d| d.join(name)) {
            if cand.is_file() {
                return Ok(cand);
            }
        }
    }
    Err(AppError::msg(format!(
        "bundled Tailscale binary '{name}' not found — set ARCADE_TAILSCALE_DIR (dev) or install the bundled client"
    )))
}

/// Both binaries present? The UI greys out remote-play-over-internet otherwise.
pub fn mesh_available() -> bool {
    mesh_bin(CLI_BIN).is_ok() && mesh_bin(DAEMON_BIN).is_ok()
}

/// Private per-user state dir for our bundled `tailscaled`, kept separate from
/// any system Tailscale install so the two never fight over one state file.
fn mesh_state_dir() -> AppResult<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var("HOME").map(|h| PathBuf::from(h).join(".local/share"))
    }
    .map_err(|_| AppError::msg("cannot resolve a state directory for tailscaled"))?;
    Ok(base.join("ArcadeLauncher").join("tailscale"))
}

/// Run the bundled `tailscale` CLI with `args`, returning stdout on success.
fn run_cli(args: &[String]) -> AppResult<String> {
    let exe = mesh_bin(CLI_BIN)?;
    let mut cmd = Command::new(&exe);
    cmd.args(args).stdin(Stdio::null());
    crate::proc::hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| AppError::msg(format!("tailscale invoke failed: {e}")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(AppError::msg(format!(
            "tailscale {} failed: {}",
            args.first().cloned().unwrap_or_default(),
            err.trim()
        )))
    }
}

/// `tailscale status --json`, or Err when no daemon is reachable.
fn status_json() -> AppResult<String> {
    run_cli(&["status".to_string(), "--json".to_string()])
}

/// Best-effort unprivileged daemon spawn (Linux/dev). No-op if the CLI already
/// reaches one. Windows does NOT use this — it installs a LocalSystem service in
/// [`join`] so the WinTun adapter can be created with the right privileges.
#[cfg(not(windows))]
fn ensure_daemon() -> AppResult<()> {
    if status_json().is_ok() {
        return Ok(());
    }
    let daemon = mesh_bin(DAEMON_BIN)?;
    let state_dir = mesh_state_dir()?;
    let _ = std::fs::create_dir_all(&state_dir);
    let mut cmd = Command::new(&daemon);
    cmd.arg("--statedir")
        .arg(&state_dir)
        .stdin(Stdio::null())
        .stdout(crate::proc::log_stdio("tailscaled.log"))
        .stderr(crate::proc::log_stdio("tailscaled.log"));
    crate::proc::hide_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| AppError::msg(format!("failed to start tailscaled: {e}")))?;
    Ok(())
}

/// PowerShell single-quoted literal (doubles embedded quotes) — safe for the
/// bundled-binary paths and the staged script path.
#[cfg(windows)]
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The elevated step: register the bundled `tailscaled` as an auto-start
/// LocalSystem service **and start it**. `install-system-daemon` only *registers*
/// the service (it leaves it Stopped → `ERROR_SERVICE_NEVER_STARTED`), so the
/// explicit `Start-Service` is load-bearing — that was the original bug. Both the
/// `tailscale up` join and all later `status`/`set`/`resolve` calls then run
/// **unprivileged** from the launcher (verified: on Windows the running
/// LocalSystem daemon grants the interactive user LocalAPI access with no
/// `--operator`), so no auth key or operator name is ever passed through this
/// elevated batch. Idempotent: skips the install when the service already exists,
/// and `Start-Service` is a no-op when it's already Running.
#[cfg(windows)]
fn build_service_install_script(tailscaled: &PathBuf) -> String {
    let tsd = ps_quote(&tailscaled.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'\r\n\
         $svc = Get-Service -Name 'Tailscale' -ErrorAction SilentlyContinue\r\n\
         if (-not $svc) {{ & {tsd} install-system-daemon }}\r\n\
         Start-Service -Name 'Tailscale'\r\n"
    )
}

/// Launch `script_path` elevated via a single UAC prompt and wait for it. The
/// outer (unprivileged) PowerShell uses `Start-Process -Verb RunAs` so declining
/// UAC surfaces as a non-zero exit (→ `Err`), not a silent no-op.
#[cfg(windows)]
fn run_elevated_powershell(script_path: &PathBuf) -> AppResult<()> {
    let inner = format!(
        "Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden \
         -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',{})",
        ps_quote(&script_path.to_string_lossy())
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &inner])
        .stdin(Stdio::null());
    crate::proc::hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| AppError::msg(format!("failed to launch elevated mesh bring-up: {e}")))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(AppError::msg(format!(
            "elevated mesh bring-up failed (UAC declined?): {}",
            err.trim()
        )))
    }
}

/// Windows: ensure the bundled `tailscaled` LocalSystem service is installed and
/// running (one UAC prompt the first time; a no-op reached only when the daemon
/// isn't already reachable). The actual `tailscale up` join runs unprivileged in
/// [`join`] afterward. Because the service is auto-start, every later session
/// finds it Running → [`join`]'s fast path skips this entirely.
#[cfg(windows)]
fn windows_ensure_service() -> AppResult<()> {
    let tailscaled = mesh_bin(DAEMON_BIN)?;
    let state_dir = mesh_state_dir()?;
    let _ = std::fs::create_dir_all(&state_dir);
    let script_path = state_dir.join("mesh-service-install.ps1");
    std::fs::write(&script_path, build_service_install_script(&tailscaled))
        .map_err(|e| AppError::msg(format!("failed to stage mesh service-install script: {e}")))?;

    let ran = run_elevated_powershell(&script_path);
    let _ = std::fs::remove_file(&script_path);
    ran?;

    // `tailscale status --json` exits 0 as soon as the daemon's LocalAPI answers
    // (even before login), so this confirms the service is up and ready for `up`.
    for _ in 0..20 {
        if status_json().is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    Err(AppError::msg(
        "tailscaled service did not become reachable after install (UAC declined or driver/service error)",
    ))
}

/// Derive the local node's mesh membership from `tailscale status`.
pub fn current_state() -> MeshState {
    match status_json() {
        Ok(js) => match control::parse_self_mesh_ip(&js) {
            Some(ip) => MeshState {
                phase: MeshPhase::Up,
                self_ip: Some(ip),
                last_error: None,
            },
            // Daemon answered but we hold no mesh IP yet → mid-join.
            None => MeshState {
                phase: MeshPhase::Connecting,
                self_ip: None,
                last_error: None,
            },
        },
        Err(_) => MeshState {
            phase: MeshPhase::Down,
            self_ip: None,
            last_error: None,
        },
    }
}

/// Join the overlay with an account-minted pre-auth key, returning the resulting
/// state.
///
/// **Fast path (both platforms):** if a daemon is already reachable, just
/// (re)issue `tailscale up` — no elevation. On Windows this is every call after
/// the first, because the service stays installed and this user is an operator.
///
/// **Windows first run:** no daemon reachable → [`windows_ensure_service`]
/// installs + starts the LocalSystem service under one UAC prompt, then `up` runs
/// unprivileged. **Linux/dev:** spawn the daemon unprivileged, then `up`.
pub fn join(up: &UpArgs) -> AppResult<MeshState> {
    if !status_json().is_ok() {
        #[cfg(windows)]
        {
            windows_ensure_service()?;
        }
        #[cfg(not(windows))]
        {
            ensure_daemon()?;
        }
    }
    // The daemon is reachable now (running service / spawned child); `up` is an
    // unprivileged LocalAPI call on every platform.
    run_cli(&up.cli_args())?;
    Ok(current_state())
}

/// Resolve a host's mesh IP by node hostname (only if it's online in the
/// tailnet) so the address selector can fall back to it when LAN is unreachable.
pub fn resolve_peer(hostname: &str) -> AppResult<Option<String>> {
    Ok(control::peer_mesh_ip(&status_json()?, hostname))
}

// ---- Tauri commands ---------------------------------------------------------
// Async + spawn_blocking so the (blocking) process calls never stall the
// runtime. The React layer fetches a pre-auth key from the server
// (`POST /api/social/mesh/preauth`) using the existing session, then hands it to
// `mesh_join`; resolution/selection feed the existing stream-launch flow.

/// Are the bundled Tailscale binaries present?
#[tauri::command]
pub fn mesh_is_available() -> bool {
    mesh_available()
}

/// Current local mesh state (phase + our mesh IP).
#[tauri::command]
pub async fn mesh_status() -> AppResult<MeshState> {
    tokio::task::spawn_blocking(current_state)
        .await
        .map_err(|e| AppError::msg(format!("mesh status task failed: {e}")))
}

/// Join the Headscale overlay with a server-minted pre-auth key. `ephemeral`
/// true for a stream client (auto-reaped), false for a persistent host.
#[tauri::command]
pub async fn mesh_join(auth_key: String, hostname: String, ephemeral: bool) -> AppResult<MeshState> {
    tokio::task::spawn_blocking(move || {
        let up = if ephemeral {
            UpArgs::client(auth_key, hostname)
        } else {
            UpArgs::host(auth_key, hostname)
        };
        join(&up)
    })
    .await
    .map_err(|e| AppError::msg(format!("mesh join task failed: {e}")))?
}

/// Resolve a paired host's mesh IP by its node hostname (None if offline/absent).
#[tauri::command]
pub async fn mesh_resolve_host(hostname: String) -> AppResult<Option<String>> {
    tokio::task::spawn_blocking(move || resolve_peer(&hostname))
        .await
        .map_err(|e| AppError::msg(format!("mesh resolve task failed: {e}")))?
}
