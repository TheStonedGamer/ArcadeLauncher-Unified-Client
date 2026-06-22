//! Remote game streaming (Sunshine/Moonlight) — T12k.
//!
//! Pure-core-first, like the rest of the client: this module owns the IO-free
//! host model + Sunshine `apps.json` shapes + the "is this game streamable"
//! decision (`host`). The host-control transport (Sunshine HTTPS config API,
//! pairing) and the Moonlight launch seam land on top in later T12k subtasks.
//!
//! Until the T12k-2 transport consumes it, the pure model has no in-tree
//! caller, so the module allows dead code the way the other core-first modules
//! (`download`, `saves`, `requests`, `social`) do.
#![allow(dead_code)]

pub mod commands;
pub mod control;
pub mod engine;
pub mod engine_conn;
pub mod host;
pub mod mesh;
pub mod moonlight;
pub mod store;
