//! This machine's identity on the social gateway (0.14).
//!
//! The gateway used to key connections by account alone, so a user signed in on
//! a PC and a phone had two indistinguishable sockets. Remote install needs to
//! address one machine, so every connection now carries a device id.
//!
//! The id is *derived*, not stored: SHA-256 over the host name and user name.
//! That avoids a state file to write, migrate and lose, and it gives the right
//! answer by construction — reinstalling the launcher, or running it twice,
//! keeps the same id, because it is the same machine. Two different users on
//! one PC get different ids, which is also right: their libraries differ.
//!
//! It is a plain hash, not a secret. It never authorises anything: the server
//! only ever matches it against sockets already authenticated as the same
//! account, so knowing someone's device id gains an attacker nothing.

use sha2::{Digest, Sha256};

/// What this client reports itself as. The server only sends install commands
/// to devices of kind "desktop".
pub const DEVICE_KIND: &str = "desktop";

/// Characters of hash we keep. 24 hex characters is 96 bits — far past any
/// collision concern for one household's machines, and short enough to read in
/// a log line.
const ID_LEN: usize = 24;

/// Derive this machine's stable device id from its host and user names.
///
/// Both inputs are lower-cased and trimmed first, so a host name that changes
/// case between boots (Windows reports it inconsistently) does not silently
/// become a second device in the picker.
pub fn device_id(host: &str, user: &str) -> String {
    let mut h = Sha256::new();
    h.update(host.trim().to_lowercase().as_bytes());
    h.update([0x1fu8]); // separator, so ("ab","c") and ("a","bc") differ
    h.update(user.trim().to_lowercase().as_bytes());
    hex::encode(h.finalize())[..ID_LEN].to_string()
}

/// The label shown in the phone's device picker. The host name is what the
/// owner actually calls the machine; the user name is only a fallback, and a
/// generic word is better than an empty row.
pub fn device_name(host: &str, user: &str) -> String {
    let host = host.trim();
    if !host.is_empty() {
        return host.chars().take(64).collect();
    }
    let user = user.trim();
    if !user.is_empty() {
        return format!("{}'s PC", user.chars().take(48).collect::<String>());
    }
    "PC".to_string()
}

/// Read the host and user names from the environment, falling back to empty
/// strings. Separated from the pure functions above so those stay testable.
pub fn local_identity() -> (String, String) {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_default();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    (host, user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_is_stable_for_the_same_machine() {
        assert_eq!(device_id("ARCADE-PC", "brian"), device_id("ARCADE-PC", "brian"));
    }

    #[test]
    fn case_and_padding_do_not_create_a_second_device() {
        let want = device_id("arcade-pc", "brian");
        assert_eq!(device_id("ARCADE-PC", "Brian"), want);
        assert_eq!(device_id("  arcade-pc  ", " brian "), want);
    }

    #[test]
    fn different_machines_and_users_get_different_ids() {
        assert_ne!(device_id("pc-a", "brian"), device_id("pc-b", "brian"));
        assert_ne!(device_id("pc-a", "brian"), device_id("pc-a", "sam"));
    }

    #[test]
    fn the_separator_stops_the_fields_running_together() {
        // Without a separator these two would hash identically.
        assert_ne!(device_id("ab", "c"), device_id("a", "bc"));
    }

    #[test]
    fn the_id_is_always_routable_as_is() {
        let id = device_id("ARCADE-PC", "brian");
        assert_eq!(id.len(), ID_LEN);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
    }

    #[test]
    fn an_empty_environment_still_yields_an_id() {
        let id = device_id("", "");
        assert_eq!(id.len(), ID_LEN);
    }

    #[test]
    fn the_name_prefers_the_host_name() {
        assert_eq!(device_name("Living Room PC", "brian"), "Living Room PC");
        assert_eq!(device_name("  Den-PC ", "brian"), "Den-PC");
    }

    #[test]
    fn the_name_falls_back_through_user_to_a_generic_word() {
        assert_eq!(device_name("", "brian"), "brian's PC");
        assert_eq!(device_name("   ", "  "), "PC");
    }

    #[test]
    fn the_name_is_capped_so_the_picker_cannot_be_flooded() {
        assert_eq!(device_name(&"x".repeat(200), "").chars().count(), 64);
    }
}
