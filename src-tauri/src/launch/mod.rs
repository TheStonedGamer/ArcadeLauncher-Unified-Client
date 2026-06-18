//! Launch feature: resolve a game's run target, run pre/post hooks, spawn the
//! process, and track the play session (playtime via the `game-exited` event).

pub mod commands;
pub mod hooks;
pub mod runner;
pub mod session;
pub mod target;
