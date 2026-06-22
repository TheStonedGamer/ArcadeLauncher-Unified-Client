//! Mesh VPN (Headscale/Tailscale) integration for play-from-anywhere (T12k-8).
//!
//! Pure-core-first, like the rest of the streaming subsystem: `control` owns the
//! IO-free join model, CGNAT address validation, `tailscale status` parsing, and
//! the LAN-vs-mesh address-selection decision. The transport that spawns and
//! supervises the **bundled** `tailscaled` and speaks its LocalAPI (`conn`) lands
//! on top — Tailscale ships inside the installer next to the stream engine, so
//! there is never a separate user-facing Tailscale install.
#![allow(dead_code)]

pub mod control;
pub mod conn;
