//! Catalog feature: the `library.json` data model, disk loader, and the
//! commands the webview calls. Kept as small sibling files so each stays
//! readable and editable in isolation.

pub mod commands;
pub mod loader;
pub mod model;
