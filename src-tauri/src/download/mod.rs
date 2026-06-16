//! Game install / download feature. T4a lands the deterministic, IO-free core —
//! the install manifest model, safe target-path resolution (path-traversal
//! rejection mirroring the C++ client), SHA-256 verification, and the per-game
//! download queue state machine — all exhaustively unit-tested. The live HTTP
//! transport (resumable ranged GETs, concurrency + bandwidth caps, extraction)
//! plugs in on top in T4b/T4c.

// The live transport (T4b) is the first consumer of this core; until then it is
// exercised only by its unit tests.
#![allow(dead_code)]

pub mod commands;
pub mod endpoint;
pub mod engine;
pub mod extract;
pub mod manifest;
pub mod paths;
pub mod queue;
pub mod rate;
pub mod records;
pub mod verify;
