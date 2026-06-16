//! Global hotkey feature: a tested pure core (`shortcut`) that parses/validates
//! an accelerator and decides the window toggle, plus thin desktop-only glue
//! (`register`) that wires it to `tauri-plugin-global-shortcut` and the window.

pub mod commands;
pub mod shortcut;

#[cfg(desktop)]
pub mod register;
