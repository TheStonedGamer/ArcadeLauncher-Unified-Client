//! In-client Game Requests board (T12h). Surfaces the standalone
//! `ArcadeLauncher-Requests` service (browse / upvote / request a release)
//! inside the launcher instead of a separate web app.
//!
//! `api.rs` is the pure URL-shaping + response-parsing core (unit-tested);
//! `commands.rs` (added in a later slice) is the thin HTTP + cookie seam the
//! webview calls.
//!
//! Pure core lands ahead of the transport/UI slices, so some builders aren't
//! referenced by non-test code yet.
#![allow(dead_code)]

pub mod api;
