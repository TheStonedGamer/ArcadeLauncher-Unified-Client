//! System tray + window-lifecycle feature: a tested pure decision core
//! (`behavior`) and desktop-only glue (`setup`) that builds the tray icon,
//! routes close-to-tray, and applies launch-minimized.

pub mod behavior;

#[cfg(desktop)]
pub mod setup;
