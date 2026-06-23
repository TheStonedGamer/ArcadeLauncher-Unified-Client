//! Transport for the account-brokered **My PCs** view (T12k-7 / T12k-9).
//!
//! Gathers *this* machine's account-stable identity (a persisted device id), its
//! display name, and its connect addresses (auto-detected LAN IPv4 + the mesh IP
//! when the overlay is up), then talks to the server's `/api/social/hosts*`
//! endpoints with the session bearer token — mirroring `social/commands.rs`
//! (host + token passed per-call from the renderer; the token never persists
//! here). The IO-free model + selection live in `mypcs.rs`.
//!
//! Discovery is push-free on the receive side: the server's `stream_host_update`
//! frames arrive over the existing social WebSocket as `social://frame` events,
//! so the renderer just refetches `my_pcs` when it sees one — no transport hook.

use crate::error::{AppError, AppResult};
use crate::social::endpoint::Endpoint;
use crate::streaming::mesh::conn::current_state;
use crate::streaming::mypcs::{MyPc, MyPcApp};
use serde::{Deserialize, Serialize};
use std::hash::{BuildHasher, Hash, Hasher};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

/// HTTP client for the My PCs REST calls — same bounded timeouts as the social
/// transport so an unreachable gateway fails fast instead of spinning the UI.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

/// This device's account-stable identity + advertised connect paths. Sent on
/// register and in the WS `stream_host_announce` heartbeat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfDevice {
    pub device_id: String,
    pub name: String,
    pub lan_addr: String,
    pub mesh_addr: String,
    pub cert_fp: String,
}

/// Path to the persisted device-id file (`app_config_dir/device_id`).
fn device_id_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("device_id"))
}

/// A 128-bit hex id from OS entropy, without pulling in the `uuid` crate. Each
/// `RandomState` is seeded from the OS RNG, so hashing a constant under two fresh
/// states yields two independent 64-bit values; the wall clock adds a little
/// more. Generated once and persisted, so a handful of personal devices never
/// collide.
fn gen_device_id() -> String {
    let seed = |salt: u64| -> u64 {
        let s = std::collections::hash_map::RandomState::new();
        let mut h = s.build_hasher();
        salt.hash(&mut h);
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
            .hash(&mut h);
        h.finish()
    };
    format!("{:016x}{:016x}", seed(0x9E37_79B9), seed(0x85EB_CA6B))
}

/// Read this device's persisted id, generating + saving one on first use.
fn device_id(app: &tauri::AppHandle) -> AppResult<String> {
    let path = device_id_path(app)?;
    if let Ok(s) = std::fs::read_to_string(&path) {
        let id = s.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = gen_device_id();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, &id).map_err(|e| AppError::msg(format!("can't save device id: {e}")))?;
    Ok(id)
}

/// A human label for this PC — the OS hostname (Windows `COMPUTERNAME`, else
/// `HOSTNAME`), falling back to a generic label so the row is never blank.
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::env::var("HOSTNAME").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My PC".to_string())
}

/// Best-effort LAN IPv4 of the default interface, via the standard UDP-connect
/// trick: connecting a UDP socket sets a default route without sending packets,
/// so `local_addr()` reveals the outbound interface address. Empty on failure
/// (e.g. no network) — the device simply advertises no LAN path.
fn detect_lan_ipv4() -> String {
    let probe = || -> std::io::Result<String> {
        let sock = UdpSocket::bind("0.0.0.0:0")?;
        // 8.8.8.8 is never actually contacted (UDP connect is routing-only); it
        // just picks the interface that would reach the public internet.
        sock.connect("8.8.8.8:80")?;
        let ip = sock.local_addr()?.ip();
        Ok(ip.to_string())
    };
    probe().unwrap_or_default()
}

/// Gather this machine's identity + connect paths. `mesh_addr` is empty unless the
/// overlay is up (T12k-8); `cert_fp` is empty until brokered auto-pin lands.
async fn gather_self(app: &tauri::AppHandle) -> AppResult<SelfDevice> {
    let device_id = device_id(app)?;
    let mesh_addr = tokio::task::spawn_blocking(current_state)
        .await
        .ok()
        .and_then(|s| s.self_ip)
        .unwrap_or_default();
    let lan_addr = tokio::task::spawn_blocking(detect_lan_ipv4)
        .await
        .unwrap_or_default();
    Ok(SelfDevice {
        device_id,
        name: device_name(),
        lan_addr,
        mesh_addr,
        cert_fp: String::new(),
    })
}

/// This device's descriptor (id/name/addresses), for the renderer's
/// self-exclusion and to build the WS announce heartbeat frame.
#[tauri::command]
pub async fn mypcs_self(app: tauri::AppHandle) -> AppResult<SelfDevice> {
    gather_self(&app).await
}

/// A ready-to-send `stream_host_announce` WS frame (JSON string) for the renderer
/// to push via `social_send` on the heartbeat — keeps `last_seen` fresh so this
/// PC reads "online" to the account's other devices.
#[tauri::command]
pub async fn mypcs_announce_frame(app: tauri::AppHandle) -> AppResult<String> {
    let me = gather_self(&app).await?;
    Ok(serde_json::json!({
        "type": "stream_host_announce",
        "payload": {
            "deviceId": me.device_id,
            "name": me.name,
            "lanAddr": me.lan_addr,
            "meshAddr": me.mesh_addr,
            "certFp": me.cert_fp,
        },
    })
    .to_string())
}

/// Durable upsert of this device into the account registry (`POST /hosts/register`).
/// Called once on sign-in so the row exists even before the WS pump warms up; the
/// server also notifies the account's other devices.
/// `server_cert_pem` (optional) is this PC's Sunshine server cert, published only when host mode is
/// on so clients can pin it for zero-PIN auto-pair; the server preserves any stored cert when it's
/// omitted (the sign-in / heartbeat register passes none).
#[tauri::command]
pub async fn mypcs_register(
    app: tauri::AppHandle,
    host: String,
    token: String,
    server_cert_pem: Option<String>,
) -> AppResult<()> {
    let me = gather_self(&app).await?;
    let body = serde_json::json!({
        "deviceId": me.device_id,
        "name": me.name,
        "lanAddr": me.lan_addr,
        "meshAddr": me.mesh_addr,
        "certFp": me.cert_fp,
        "serverCertPem": server_cert_pem.unwrap_or_default(),
    });
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .post(endpoint.host_register_url())
        .bearer_auth(endpoint.token())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("device register failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("device register failed (HTTP {})", resp.status())));
    }
    Ok(())
}

/// One account-registered streaming-client cert (`GET /api/social/client-certs`). Hosts seed each
/// into Sunshine's trust store so the owning PC streams with no PIN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCert {
    pub device_id: String,
    #[serde(default)]
    pub name: String,
    pub cert_pem: String,
}

/// Publish this device's streaming-client cert to the account registry
/// (`POST /api/social/client-certs`) so every host on the account can pre-authorize it. Idempotent
/// per device. `cert_pem` comes from the engine (`client.identity`).
#[tauri::command]
pub async fn client_cert_register(
    app: tauri::AppHandle,
    host: String,
    token: String,
    cert_pem: String,
) -> AppResult<()> {
    let self_id = device_id(&app)?;
    let body = serde_json::json!({ "deviceId": self_id, "name": device_name(), "certPem": cert_pem });
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .post(endpoint.client_certs_url())
        .bearer_auth(endpoint.token())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("client cert publish failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("client cert publish failed (HTTP {})", resp.status())));
    }
    Ok(())
}

/// Every client cert registered to the account (`GET /api/social/client-certs`). The host seeds
/// these into Sunshine (`host.trustClient`) when hosting so account PCs auto-pair with no PIN.
#[tauri::command]
pub async fn client_cert_list(host: String, token: String) -> AppResult<Vec<ClientCert>> {
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        certs: Vec<ClientCert>,
    }
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .get(endpoint.client_certs_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("client cert list failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("client cert list failed (HTTP {})", resp.status())));
    }
    let body: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid client cert response: {e}")))?;
    Ok(body.certs)
}

/// Every PC signed into the account (`GET /hosts`), with this device removed —
/// My PCs lists the *other* devices. `online` is server-derived from freshness.
#[tauri::command]
pub async fn mypcs_list(app: tauri::AppHandle, host: String, token: String) -> AppResult<Vec<MyPc>> {
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        hosts: Vec<MyPc>,
    }
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .get(endpoint.hosts_url())
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("hosts request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("hosts lookup failed (HTTP {})", resp.status())));
    }
    let body: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid hosts response: {e}")))?;
    let self_id = device_id(&app).unwrap_or_default();
    Ok(crate::streaming::mypcs::exclude_self(body.hosts, &self_id))
}

/// Forget one of the caller's devices (`DELETE /hosts/:id`) and its published apps.
#[tauri::command]
pub async fn mypcs_forget(host: String, token: String, device_id: String) -> AppResult<()> {
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .delete(endpoint.host_url(&device_id))
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("forget device failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("forget device failed (HTTP {})", resp.status())));
    }
    Ok(())
}

/// A PC's last-published library (`GET /hosts/:id/apps`) — browsable even while
/// that PC is offline.
#[tauri::command]
pub async fn mypcs_apps(host: String, token: String, device_id: String) -> AppResult<Vec<MyPcApp>> {
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        apps: Vec<MyPcApp>,
    }
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .get(endpoint.host_apps_url(&device_id))
        .bearer_auth(endpoint.token())
        .send()
        .await
        .map_err(|e| AppError::msg(format!("host apps request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("host apps lookup failed (HTTP {})", resp.status())));
    }
    let body: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::msg(format!("invalid host apps response: {e}")))?;
    Ok(body.apps)
}

/// Publish *this* device's library (`PUT /hosts/:self/apps`, full replace) so its
/// games are browsable from the account's other devices. `cover_ref` values must
/// be relative art refs.
#[tauri::command]
pub async fn mypcs_publish(
    app: tauri::AppHandle,
    host: String,
    token: String,
    apps: Vec<MyPcApp>,
) -> AppResult<()> {
    #[derive(Serialize)]
    struct Body {
        apps: Vec<MyPcApp>,
    }
    let self_id = device_id(&app)?;
    let endpoint = Endpoint::new(host, token);
    let resp = http_client()
        .put(endpoint.host_apps_url(&self_id))
        .bearer_auth(endpoint.token())
        .json(&Body { apps })
        .send()
        .await
        .map_err(|e| AppError::msg(format!("publish library failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("publish library failed (HTTP {})", resp.status())));
    }
    Ok(())
}
