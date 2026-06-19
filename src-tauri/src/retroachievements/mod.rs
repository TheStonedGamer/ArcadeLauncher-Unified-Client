//! RetroAchievements integration (T12a). The client can't inject achievements
//! into third-party standalone emulators (PCSX2/DuckStation/RetroArch ship their
//! own RA clients), so this integrates the **RetroAchievements Web API** instead:
//! it pulls the signed-in user's score/rank and recent unlocks so the launcher
//! can show RA progress and map the user's points onto its own level curve.
//!
//! `api.rs` is the pure request-shaping + response-parsing core (unit-tested);
//! `commands.rs` is the thin HTTP seam the webview calls.

pub mod api;
pub mod commands;
