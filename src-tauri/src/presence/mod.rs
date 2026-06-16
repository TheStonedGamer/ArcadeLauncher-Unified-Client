//! Discord Rich Presence feature: a tested pure activity core (`activity`) plus
//! a thin, settings-gated IPC connector (`client`) and the commands the
//! frontend calls on game launch/exit.

pub mod activity;
pub mod client;
pub mod commands;
