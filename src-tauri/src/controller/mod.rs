//! Unified controller mapping: one host-centric (Xbox-style) button map per
//! emulator, translated into each emulator's native pad config.
//!
//! * `model`       — the host-button → SDL-token profile + persisted collection.
//! * `serializers` — pure per-emulator config writers (PCSX2, DuckStation).
//! * `ini`         — non-destructive INI editor the serializers build on.
//! * `bios`        — copy-install staged BIOS into an emulator's bios dir.
//! * `commands`    — the Tauri command layer: path resolution, backup, persist.

pub mod bios;
pub mod commands;
pub mod ini;
pub mod model;
pub mod serializers;
