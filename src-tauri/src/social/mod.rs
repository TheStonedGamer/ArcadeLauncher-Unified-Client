//! Social feature: the value model and the gateway wire protocol shared with the
//! C++ client's backend. T3a lands the deterministic, fully-tested core (model +
//! protocol); the live WebSocket/REST transport plugs in here in a later slice.

// The live WebSocket/REST transport (T3b) is the first consumer of these types;
// until then the model/protocol are exercised only by their unit tests.
#![allow(dead_code)]

pub mod backoff;
pub mod commands;
pub mod endpoint;
pub mod model;
pub mod protocol;
pub mod transport;
