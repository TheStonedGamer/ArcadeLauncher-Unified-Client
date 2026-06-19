//! Unified, host-centric controller mapping model.
//!
//! The user edits ONE button map expressed in terms of the physical host
//! controller (Xbox-style: A/B/X/Y, bumpers, triggers, stick clicks, D-pad).
//! Each host button is bound to an SDL2 GameController token (the same token
//! vocabulary stenzek's `SDLInputSource` uses, shared by PCSX2 and DuckStation).
//! The default is the identity mapping — every host button drives its namesake.
//!
//! Per-emulator serializers translate this single map into each emulator's
//! native config (e.g. a PlayStation pad's Cross slot is fed by whatever the
//! host "A" button is bound to). Sticks are not rebindable here — only their
//! dead zone is tunable — so the analog axes always use their identity tokens.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// SDL device prefix. We bind device 0 (the first connected controller); the
/// full binding token is `SDL-0/<input>` (e.g. `SDL-0/FaceSouth`).
pub const SDL_DEVICE: &str = "SDL-0";

/// A logical host (Xbox-style) button the user can rebind to an SDL input.
pub struct HostBtn {
    /// Stable key used in the saved profile JSON and the UI.
    pub id: &'static str,
    /// Human label shown in the editor.
    pub label: &'static str,
    /// Identity SDL token — the input that drives this button by default.
    pub default_token: &'static str,
}

/// Every rebindable host button, in display order. The tokens are the
/// authoritative SDL `SDLInputSource` names confirmed from PCSX2 source.
pub const HOST_BUTTONS: &[HostBtn] = &[
    HostBtn { id: "a", label: "A", default_token: "FaceSouth" },
    HostBtn { id: "b", label: "B", default_token: "FaceEast" },
    HostBtn { id: "x", label: "X", default_token: "FaceWest" },
    HostBtn { id: "y", label: "Y", default_token: "FaceNorth" },
    HostBtn { id: "back", label: "Back / Select", default_token: "Back" },
    HostBtn { id: "start", label: "Start", default_token: "Start" },
    HostBtn { id: "leftBumper", label: "LB", default_token: "LeftShoulder" },
    HostBtn { id: "rightBumper", label: "RB", default_token: "RightShoulder" },
    HostBtn { id: "leftTrigger", label: "LT", default_token: "LeftTrigger" },
    HostBtn { id: "rightTrigger", label: "RT", default_token: "RightTrigger" },
    HostBtn { id: "leftStick", label: "L3 (left stick click)", default_token: "LeftStick" },
    HostBtn { id: "rightStick", label: "R3 (right stick click)", default_token: "RightStick" },
    HostBtn { id: "dpadUp", label: "D-Pad Up", default_token: "DPadUp" },
    HostBtn { id: "dpadDown", label: "D-Pad Down", default_token: "DPadDown" },
    HostBtn { id: "dpadLeft", label: "D-Pad Left", default_token: "DPadLeft" },
    HostBtn { id: "dpadRight", label: "D-Pad Right", default_token: "DPadRight" },
];

/// The SDL `SDLInputSource` button tokens a host button may be rebound to, in a
/// sensible display order. These are the digital inputs (face/shoulder/dpad/stick
/// click/system); analog axes are not offered here because sticks and triggers
/// drive fixed slots — only the dead zone is tunable. Confirmed from PCSX2's
/// `s_sdl_button_setting_names` plus the trigger axes used as buttons (L2/R2).
pub const SDL_BUTTON_TOKENS: &[&str] = &[
    "FaceSouth",
    "FaceEast",
    "FaceWest",
    "FaceNorth",
    "Back",
    "Guide",
    "Start",
    "LeftStick",
    "RightStick",
    "LeftShoulder",
    "RightShoulder",
    "LeftTrigger",
    "RightTrigger",
    "DPadUp",
    "DPadDown",
    "DPadLeft",
    "DPadRight",
];

/// The default (identity) dead zone, mirroring the launcher's own default and
/// the emulator defaults.
pub const DEFAULT_DEAD_ZONE: f32 = 0.15;

fn default_dead_zone() -> f32 {
    DEFAULT_DEAD_ZONE
}

/// One emulator's controller profile: the host-button → SDL-token map plus a
/// stick dead zone. Stored per emulator id in `controller_profiles.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    /// Analog stick dead zone in [0,1].
    pub dead_zone: f32,
    /// Host-button id → SDL input token (without the `SDL-0/` prefix). Missing
    /// entries fall back to the button's identity token, so a partial profile
    /// is always complete in practice.
    pub bindings: BTreeMap<String, String>,
}

impl Default for Profile {
    fn default() -> Self {
        Profile { dead_zone: default_dead_zone(), bindings: BTreeMap::new() }
    }
}

impl Profile {
    /// The SDL token bound to `host_id`, falling back to its identity token.
    /// Unknown ids return an empty string (callers skip empty tokens).
    pub fn token_for(&self, host_id: &str) -> String {
        if let Some(t) = self.bindings.get(host_id) {
            return t.clone();
        }
        HOST_BUTTONS
            .iter()
            .find(|b| b.id == host_id)
            .map(|b| b.default_token.to_string())
            .unwrap_or_default()
    }

    /// The full `SDL-0/<token>` binding string for `host_id`.
    pub fn binding_for(&self, host_id: &str) -> String {
        format!("{}/{}", SDL_DEVICE, self.token_for(host_id))
    }
}

/// The persisted set of per-emulator controller profiles, keyed by emulator id.
/// `BTreeMap` keeps `controller_profiles.json` in a stable, diff-friendly order.
/// Mirrors the install-records store: pure collection ops here, with the only
/// disk seam in the [`load`]/[`save`] pair below (atomic temp-file + rename).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profiles {
    pub profiles: BTreeMap<String, Profile>,
}

impl Profiles {
    /// The stored profile for `emulator_id`, if the user has saved one.
    pub fn get(&self, emulator_id: &str) -> Option<&Profile> {
        self.profiles.get(emulator_id)
    }

    /// The stored profile for `emulator_id`, or the identity default when none
    /// has been saved — so callers always have a complete profile to apply.
    pub fn get_or_default(&self, emulator_id: &str) -> Profile {
        self.get(emulator_id).cloned().unwrap_or_default()
    }

    /// Insert or replace the profile for `emulator_id`.
    pub fn set(&mut self, emulator_id: &str, profile: Profile) {
        self.profiles.insert(emulator_id.to_string(), profile);
    }
}

/// Load profiles from `path`. A missing or empty file yields an empty set, so a
/// first run (no saved profiles yet) is not an error.
pub fn load(path: &Path) -> AppResult<Profiles> {
    if !path.exists() {
        return Ok(Profiles::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(Profiles::default());
    }
    Ok(serde_json::from_str::<Profiles>(&text)?)
}

/// Save profiles to `path` atomically (temp file + rename), creating the parent
/// directory if needed.
pub fn save(path: &Path, profiles: &Profiles) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(profiles)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_is_identity() {
        let p = Profile::default();
        assert_eq!(p.token_for("a"), "FaceSouth");
        assert_eq!(p.token_for("dpadUp"), "DPadUp");
        assert_eq!(p.binding_for("leftBumper"), "SDL-0/LeftShoulder");
    }

    #[test]
    fn explicit_binding_overrides_identity() {
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into());
        assert_eq!(p.token_for("a"), "FaceEast");
        assert_eq!(p.binding_for("a"), "SDL-0/FaceEast");
        // Untouched buttons stay at identity.
        assert_eq!(p.token_for("b"), "FaceEast"); // identity for b is also FaceEast
        assert_eq!(p.token_for("y"), "FaceNorth");
    }

    #[test]
    fn unknown_button_yields_empty() {
        assert_eq!(Profile::default().token_for("nope"), "");
    }

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_ctrl_profiles_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn get_or_default_falls_back_to_identity() {
        let store = Profiles::default();
        let p = store.get_or_default("pcsx2");
        assert_eq!(p, Profile::default());
        assert!(store.get("pcsx2").is_none());
    }

    #[test]
    fn missing_file_is_empty() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), Profiles::default());
    }

    #[test]
    fn round_trip_preserves_profiles() {
        let p = tmp_path("roundtrip");
        let mut store = Profiles::default();
        let mut prof = Profile::default();
        prof.dead_zone = 0.25;
        prof.bindings.insert("a".into(), "FaceEast".into());
        store.set("pcsx2", prof);
        save(&p, &store).unwrap();
        assert_eq!(load(&p).unwrap(), store);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn tolerates_partial_and_unknown_fields() {
        let p = tmp_path("partial");
        std::fs::write(
            &p,
            r#"{"profiles":{"pcsx2":{"deadZone":0.3,"bindings":{"a":"FaceEast"}}},"extra":1}"#,
        )
        .unwrap();
        let loaded = load(&p).unwrap();
        let prof = loaded.get("pcsx2").unwrap();
        assert_eq!(prof.dead_zone, 0.3);
        assert_eq!(prof.token_for("a"), "FaceEast");
        let _ = std::fs::remove_file(&p);
    }
}
