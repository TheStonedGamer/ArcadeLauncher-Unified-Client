//! Cloud saves (T8). The deterministic, IO-free sync-decision core lands first
//! (`sync`): given the local and server-reported save-file sets for a game, it
//! decides per file whether to upload, download, leave alone, or flag a
//! conflict. The live transport (list/get/put against the server's
//! `/api/saves/:id` endpoints) plugs in on top in a later increment and simply
//! executes the plan this core produces.

// The live transport is the first consumer of this core; until then it is
// exercised only by its unit tests.
#![allow(dead_code)]

pub mod commands;
pub mod paths;
pub mod scan;
pub mod sync;
pub mod versions;
