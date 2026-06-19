//! Per-emulator native config serializers.
//!
//! Only emulators whose controller format has been validated against a real
//! config generated on this machine ship a native writer. Today that's PCSX2
//! (PS2) and DuckStation (PS1) — both built on stenzek's `SDLInputSource`, so
//! they share an identical binding token vocabulary and `[Pad1]` key scheme;
//! they differ only in the pad `Type` and which dead-zone keys they expose.
//!
//! A serializer is a PURE function over the existing file text: it enables the
//! SDL input source and rewrites the `[Pad1]` block from the unified profile,
//! leaving every other section intact (see `ini::set_keys`). Path resolution
//! and backup live in `commands.rs`; keeping the transform pure makes the exact
//! output unit-testable against the captured ground truth.

use crate::controller::ini;
use crate::controller::model::Profile;

/// An emulator we can write a native controller config for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeFormat {
    /// PCSX2 (`PCSX2.ini`), pad `Type = DualShock2`, exposes `Deadzone`.
    Pcsx2,
    /// DuckStation (`settings.ini`), pad `Type = AnalogController`.
    DuckStation,
}

/// Map a server emulator id (or platform) to a native writer, if one exists.
/// Returns None for emulators whose format isn't validated yet — those persist
/// a profile but don't get applied to disk.
pub fn native_format(emulator_id: &str) -> Option<NativeFormat> {
    match emulator_id.to_ascii_lowercase().as_str() {
        s if s.contains("pcsx2") => Some(NativeFormat::Pcsx2),
        s if s.contains("duckstation") => Some(NativeFormat::DuckStation),
        _ => None,
    }
}

/// The PlayStation pad slot → host-button id mapping. The slot name is the
/// `[Pad1]` key; the host id selects which (possibly remapped) SDL token feeds
/// it. This is the standard Xbox→DualShock layout.
const PS_SLOTS: &[(&str, &str)] = &[
    ("Up", "dpadUp"),
    ("Right", "dpadRight"),
    ("Down", "dpadDown"),
    ("Left", "dpadLeft"),
    ("Triangle", "y"),
    ("Circle", "b"),
    ("Cross", "a"),
    ("Square", "x"),
    ("Select", "back"),
    ("Start", "start"),
    ("L1", "leftBumper"),
    ("R1", "rightBumper"),
    ("L2", "leftTrigger"),
    ("R2", "rightTrigger"),
    ("L3", "leftStick"),
    ("R3", "rightStick"),
];

/// Analog stick axes are fixed (not user-rebindable here) — only their dead
/// zone is tunable. `(slot, sdl_axis)` with the sign that SDLInputSource uses.
const PS_AXES: &[(&str, &str)] = &[
    ("LUp", "-LeftY"),
    ("LDown", "+LeftY"),
    ("LLeft", "-LeftX"),
    ("LRight", "+LeftX"),
    ("RUp", "-RightY"),
    ("RDown", "+RightY"),
    ("RLeft", "-RightX"),
    ("RRight", "+RightX"),
];

/// Build the `[Pad1]` key/value list for a PlayStation-pad emulator.
fn ps_pad_keys(fmt: NativeFormat, profile: &Profile) -> Vec<(String, String)> {
    let mut kvs: Vec<(String, String)> = Vec::new();
    let pad_type = match fmt {
        NativeFormat::Pcsx2 => "DualShock2",
        NativeFormat::DuckStation => "AnalogController",
    };
    kvs.push(("Type".into(), pad_type.into()));

    // PCSX2 exposes an analog stick dead zone as a 0..1 float; DuckStation's
    // analog dead zone lives under different keys we haven't validated, so we
    // only write it for PCSX2 (the unvalidated keys are left at their default).
    if fmt == NativeFormat::Pcsx2 {
        kvs.push(("Deadzone".into(), format!("{:.6}", profile.dead_zone)));
    }

    for (slot, host_id) in PS_SLOTS {
        kvs.push((slot.to_string(), profile.binding_for(host_id)));
    }
    for (slot, axis) in PS_AXES {
        kvs.push((slot.to_string(), format!("{}/{}", crate::controller::model::SDL_DEVICE, axis)));
    }
    kvs
}

/// Apply `profile` to an emulator config's `text`, returning the new file text.
/// Enables the SDL input source and rewrites `[Pad1]`; all other sections are
/// preserved. Pure — no disk access.
pub fn serialize(fmt: NativeFormat, text: &str, profile: &Profile) -> String {
    let with_src = ini::set_keys(text, "InputSources", &[("SDL".into(), "true".into())]);
    ini::set_keys(&with_src, "Pad1", &ps_pad_keys(fmt, profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_maps_to_format() {
        assert_eq!(native_format("pcsx2-windows"), Some(NativeFormat::Pcsx2));
        assert_eq!(native_format("DuckStation"), Some(NativeFormat::DuckStation));
        assert_eq!(native_format("dolphin"), None);
        assert_eq!(native_format("xemu"), None);
    }

    #[test]
    fn pcsx2_default_profile_matches_ground_truth_tokens() {
        let out = serialize(NativeFormat::Pcsx2, "", &Profile::default());
        // SDL source enabled.
        assert!(out.contains("[InputSources]"));
        assert!(out.contains("SDL = true"));
        // Pad type + the confirmed SDL tokens for the standard layout.
        assert!(out.contains("Type = DualShock2"));
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        assert!(out.contains("Circle = SDL-0/FaceEast"));
        assert!(out.contains("Square = SDL-0/FaceWest"));
        assert!(out.contains("Triangle = SDL-0/FaceNorth"));
        assert!(out.contains("L1 = SDL-0/LeftShoulder"));
        assert!(out.contains("R2 = SDL-0/RightTrigger"));
        assert!(out.contains("Select = SDL-0/Back"));
        assert!(out.contains("L3 = SDL-0/LeftStick"));
        assert!(out.contains("Up = SDL-0/DPadUp"));
        // Sticks.
        assert!(out.contains("LLeft = SDL-0/-LeftX"));
        assert!(out.contains("RRight = SDL-0/+RightX"));
        // PCSX2 dead zone present.
        assert!(out.contains("Deadzone = 0.15"));
    }

    #[test]
    fn duckstation_uses_analog_type_and_no_deadzone_key() {
        let out = serialize(NativeFormat::DuckStation, "", &Profile::default());
        assert!(out.contains("Type = AnalogController"));
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        // We do not write the unvalidated DuckStation dead-zone key.
        assert!(!out.contains("Deadzone ="));
    }

    #[test]
    fn remap_swaps_face_buttons() {
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into());
        p.bindings.insert("b".into(), "FaceSouth".into());
        let out = serialize(NativeFormat::Pcsx2, "", &p);
        // Cross is fed by host A → now FaceEast; Circle by host B → FaceSouth.
        assert!(out.contains("Cross = SDL-0/FaceEast"));
        assert!(out.contains("Circle = SDL-0/FaceSouth"));
    }

    #[test]
    fn preserves_unrelated_sections() {
        let text = "[EmuCore]\nEnableCheats = true\n\n[Pad1]\nType = Keyboard\nCross = Keyboard/X\n";
        let out = serialize(NativeFormat::Pcsx2, text, &Profile::default());
        assert!(out.contains("[EmuCore]"));
        assert!(out.contains("EnableCheats = true"));
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        assert!(!out.contains("Keyboard/X"));
    }
}
