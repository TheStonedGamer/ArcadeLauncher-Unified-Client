//! Session & auth subsystem. Starts with the pure challenge-response crypto
//! core (`crypto`); later increments add the login command, session state, and
//! token storage that supply host+token to the social/download features.

pub mod commands;
pub mod crypto;
