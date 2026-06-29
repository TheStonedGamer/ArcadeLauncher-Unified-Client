//! Steam-style multi-library support: more than one install-root folder (one per
//! drive/location) plus the ability to move installed games between them. The
//! pure model (`model`) + atomic store (`store`) form the tested core; `disk`
//! reports free/total space, `r#move` is the cross-drive move IO, and `commands`
//! exposes it all to the webview. Install location stays data-driven — a game's
//! `install_dir` record is the source of truth — so a move is "relocate + rewrite
//! the record" and launch resolution follows for free.

pub mod commands;
pub mod disk;
pub mod model;
#[path = "move.rs"]
pub mod r#move;
pub mod store;
