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
//! Windows service** (`tailscaled install-system-daemon`) on first use — a single
//! UAC accept — and in the SAME elevated batch runs `tailscale up` and grants this
//! (non-admin) user `--operator`, so every later `status`/`up`/`resolve` is
//! unprivileged with no further prompts and the mesh survives reboots. Linux keeps
//! the unprivileged [`ensure_daemon`] spawn (needs `/dev/net/tun`). ⚠️ The
//! service-install + LocalAPI-pipe-operator path is implemented but still wants a
//! two-machine real-hardware pass (T12k-8 gate 3) to confirm the cross-internet
//! WinTun A/V stream actually connects.

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

/// The Windows account to grant `tailscale --operator`, so this non-admin user
/// can drive the LocalSystem daemon after install without further elevation.
/// `DOMAIN\\user` when a domain is set, else the bare username.
#[cfg(windows)]
fn current_windows_operator() -> Option<String> {
    let user = std::env::var("USERNAME").ok().filter(|s| !s.is_empty())?;
    match std::env::var("USERDOMAIN").ok().filter(|s| !s.is_empty()) {
        Some(domain) => Some(format!("{domain}\\{user}")),
        None => Some(user),
    }
}

/// PowerShell single-quoted literal (doubles embedded quotes) — safe for paths,
/// the auth key, hostnames, and the operator name.
#[cfg(windows)]
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The elevated bring-up script: install the service, wait for the daemon's
/// LocalAPI to answer, then `tailscale up` (the pure-core argv, already carrying
/// `--operator`). Runs as one elevated batch so it's a single UAC prompt.
#[cfg(windows)]
fn build_bring_up_script(tailscaled: &PathBuf, tailscale: &PathBuf, up_args: &[String]) -> String {
    let tsd = ps_quote(&tailscaled.to_string_lossy());
    let ts = ps_quote(&tailscale.to_string_lossy());
    let up_line = up_args.iter().map(|a| ps_quote(a)).collect::<Vec<_>>().join(" ");
    format!(
        "$ErrorActionPreference = 'Stop'\r\n\
         & {tsd} install-system-daemon\r\n\
         for ($i = 0; $i -lt 30; $i++) {{\r\n\
         \x20 & {ts} status *> $null\r\n\
         \x20 if ($LASTEXITCODE -eq 0) {{ break }}\r\n\
         \x20 Start-Sleep -Milliseconds 500\r\n\
         }}\r\n\
         & {ts} {up_line}\r\n"
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

/// Windows first-run: install the bundled `tailscaled` as an auto-start
/// LocalSystem service, grant this user `--operator`, and `tailscale up` — all
/// under one UAC prompt. Subsequent joins skip this entirely (the fast path in
/// [`join`] reaches the running service unprivileged).
#[cfg(windows)]
fn windows_service_bring_up(up: &UpArgs) -> AppResult<()> {
    let tailscaled = mesh_bin(DAEMON_BIN)?;
    let tailscale = mesh_bin(CLI_BIN)?;

    let mut up_args = up.cli_args();
    if let Some(op) = current_windows_operator() {
        up_args.push("--operator".to_string());
        up_args.push(op);
    }

    let state_dir = mesh_state_dir()?;
    let _ = std::fs::create_dir_all(&state_dir);
    let script_path = state_dir.join("mesh-bringup.ps1");
    std::fs::write(&script_path, build_bring_up_script(&tailscaled, &tailscale, &up_args))
        .map_err(|e| AppError::msg(format!("failed to stage mesh bring-up script: {e}")))?;

    let ran = run_elevated_powershell(&script_path);
    // Always delete the script — it carries the single-use pre-auth key.
    let _ = std::fs::remove_file(&script_path);
    ran?;

    // The service auto-starts; wait for its LocalAPI to accept us (operator).
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
/// **Windows first run:** no daemon reachable → [`windows_service_bring_up`]
/// installs the LocalSystem service + brings the node up under one UAC prompt.
/// **Linux/dev:** spawn the daemon unprivileged, then `up`.
pub fn join(up: &UpArgs) -> AppResult<MeshState> {
    if status_json().is_ok() {
        run_cli(&up.cli_args())?;
        return Ok(current_state());
    }
    #[cfg(windows)]
    {
        windows_service_bring_up(up)?;
    }
    #[cfg(not(windows))]
    {
        ensure_daemon()?;
        run_cli(&up.cli_args())?;
    }
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
