//! Thin Discord IPC glue. All user-visible formatting lives in the tested
//! `activity` core; this file only owns the live `discord-rich-presence` socket
//! and maps an [`Activity`] onto its payload. It is gated by the General
//! setting `discord_rich_presence` + a configured application id, so a build
//! with the feature off (or Discord not running) is a silent no-op — it can
//! never fail a launch.

use crate::error::{AppError, AppResult};
use crate::presence::activity::{self, Activity, PresenceState};
use discord_rich_presence::{
    activity as rpc, DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;

/// Live presence connection, managed as Tauri state (one per app instance).
#[derive(Default)]
pub struct PresenceManager {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Connected IPC client + the app id it was opened with, if any.
    client: Option<(String, DiscordIpcClient)>,
}

impl PresenceManager {
    /// Reconcile the live connection with the desired state. When `enabled` and
    /// `app_id` is non-empty, connect (if needed) and push the activity; when
    /// disabled or unconfigured, tear any existing connection down. Errors are
    /// returned so the caller can log them, but presence is best-effort: a
    /// failure here must never block launching or browsing.
    pub fn apply(&self, enabled: bool, app_id: &str, state: &PresenceState) -> AppResult<()> {
        let mut inner = self.inner.lock().unwrap();
        let app_id = app_id.trim();

        if !enabled || app_id.is_empty() {
            if let Some((_, mut c)) = inner.client.take() {
                let _ = c.close();
            }
            return Ok(());
        }

        // Reconnect if the app id changed (rare) or we have no connection yet.
        let need_connect = !matches!(&inner.client, Some((id, _)) if id == app_id);
        if need_connect {
            if let Some((_, mut old)) = inner.client.take() {
                let _ = old.close();
            }
            let mut c = DiscordIpcClient::new(app_id)
                .map_err(|e| AppError::msg(format!("discord ipc init: {e}")))?;
            c.connect()
                .map_err(|e| AppError::msg(format!("discord ipc connect: {e}")))?;
            inner.client = Some((app_id.to_string(), c));
        }

        let act = activity::build(state);
        let (_, client) = inner.client.as_mut().expect("just connected");
        push(client, &act)
    }

    /// Drop the connection. Best-effort cleanup hook; the OS also reclaims the
    /// socket on process exit, so it is not yet wired to a window event.
    #[allow(dead_code)]
    pub fn shutdown(&self) {
        if let Some((_, mut c)) = self.inner.lock().unwrap().client.take() {
            let _ = c.close();
        }
    }
}

/// Map a resolved [`Activity`] onto the borrowed-`&str` RPC payload and send it.
fn push(client: &mut DiscordIpcClient, act: &Activity) -> AppResult<()> {
    let mut payload = rpc::Activity::new()
        .details(&act.details)
        .state(&act.state)
        .assets(
            rpc::Assets::new()
                .large_image(act.large_image)
                .large_text(&act.large_text),
        );
    if let Some(ts) = act.start_timestamp {
        payload = payload.timestamps(rpc::Timestamps::new().start(ts));
    }
    client
        .set_activity(payload)
        .map_err(|e| AppError::msg(format!("discord set_activity: {e}")))
}
