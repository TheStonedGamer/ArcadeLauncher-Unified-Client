//! Per-emulator native config serializers.
//!
//! The user edits ONE host-centric profile (Xbox-style buttons → SDL tokens);
//! each serializer translates it into one emulator's native controller config.
//! Five emulators ship a validated native writer, in two families:
//!
//!   * **stenzek INI** — PCSX2 (`PCSX2.ini`) and DuckStation (`settings.ini`)
//!     share `SDLInputSource`, so an identical `[Pad1]` block + `SDL-0/Face*`
//!     token vocabulary covers both; they differ only in pad `Type` / dead zone.
//!   * **authored INI** — Dolphin (`GCPadNew.ini`) is written from scratch with a
//!     device-agnostic `XInput/0/Gamepad` device, so no controller GUID is needed.
//!
//! Two more are **in-place remaps** of a config the emulator already created
//! (which carries the connected pad's device id/GUID we can't synthesize): RPCS3
//! (`Default.yml`, YAML) and Ryujinx (`Config.json`, JSON). Those return `Err`
//! with a user-facing reason when no existing config is present, so the UI can
//! say "set a controller up in the emulator once, then Apply."
//!
//! Every serializer is a PURE function over the existing file text. Path
//! resolution, backups, and disk writes live in `commands.rs`; keeping the
//! transforms pure makes their exact output unit-testable against ground truth.
//!
//! The other emulators the launcher ships (xemu, xenia, Mesen, gopher64)
//! auto-bind controllers via XInput/SDL and expose no per-button remap file, so
//! they have no native writer — their profiles persist but aren't applied.

use crate::controller::ini;
use crate::controller::model::Profile;

/// An emulator we can write a native controller config for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeFormat {
    /// PCSX2 (`PCSX2.ini`), pad `Type = DualShock2`, exposes `Deadzone`.
    Pcsx2,
    /// DuckStation (`settings.ini`), pad `Type = AnalogController`.
    DuckStation,
    /// Dolphin (`GCPadNew.ini`), authored with an `XInput/0/Gamepad` device.
    Dolphin,
    /// RPCS3 (`Default.yml`), in-place remap of the `Player 1 Input` block.
    Rpcs3,
    /// Ryujinx (`Config.json`), in-place remap of `input_config[0]`.
    Ryujinx,
}

/// Map a server emulator id (or platform) to a native writer, if one exists.
/// Returns None for emulators that auto-bind controllers and have no per-button
/// config file — those persist a profile but aren't applied to disk.
pub fn native_format(emulator_id: &str) -> Option<NativeFormat> {
    match emulator_id.to_ascii_lowercase().as_str() {
        s if s.contains("pcsx2") => Some(NativeFormat::Pcsx2),
        s if s.contains("duckstation") => Some(NativeFormat::DuckStation),
        s if s.contains("dolphin") => Some(NativeFormat::Dolphin),
        s if s.contains("rpcs3") => Some(NativeFormat::Rpcs3),
        s if s.contains("ryujinx") => Some(NativeFormat::Ryujinx),
        _ => None,
    }
}

/// The launcher platform key for an emulator id, used to locate its runtime exe.
/// Covers every emulator the launcher ships — including the auto-bind ones with
/// no native writer — so the editor can report "installed" for all of them.
pub fn platform_for(emulator_id: &str) -> Option<&'static str> {
    Some(match emulator_id.to_ascii_lowercase().as_str() {
        s if s.contains("pcsx2") => "ps2",
        s if s.contains("duckstation") => "ps1",
        s if s.contains("dolphin") => "gamecube",
        s if s.contains("rpcs3") => "ps3",
        s if s.contains("ryujinx") => "switch",
        s if s.contains("xemu") => "xbox",
        s if s.contains("xenia") => "xbox360",
        s if s.contains("mesen") => "nes",
        s if s.contains("gopher64") => "n64",
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// stenzek INI (PCSX2 / DuckStation)
// ---------------------------------------------------------------------------

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
        _ => "AnalogController",
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

/// Serialize a stenzek (PCSX2 / DuckStation) config: enable the SDL source and
/// rewrite `[Pad1]`, preserving every other section.
fn serialize_stenzek(fmt: NativeFormat, text: &str, profile: &Profile) -> String {
    let with_src = ini::set_keys(text, "InputSources", &[("SDL".into(), "true".into())]);
    ini::set_keys(&with_src, "Pad1", &ps_pad_keys(fmt, profile))
}

// ---------------------------------------------------------------------------
// Dolphin (authored GCPadNew.ini, XInput device)
// ---------------------------------------------------------------------------

/// Translate an SDL token (our model's vocabulary) into the Dolphin XInput input
/// name. Empty for tokens with no GameCube equivalent.
fn dolphin_token(sdl: &str) -> &'static str {
    match sdl {
        "FaceSouth" => "Button A",
        "FaceEast" => "Button B",
        "FaceWest" => "Button X",
        "FaceNorth" => "Button Y",
        "Back" => "Back",
        "Guide" => "Guide",
        "Start" => "Start",
        "LeftShoulder" => "Shoulder L",
        "RightShoulder" => "Shoulder R",
        "LeftTrigger" => "Trigger L",
        "RightTrigger" => "Trigger R",
        "LeftStick" => "Thumb L",
        "RightStick" => "Thumb R",
        "DPadUp" => "Pad N",
        "DPadDown" => "Pad S",
        "DPadLeft" => "Pad W",
        "DPadRight" => "Pad E",
        _ => "",
    }
}

/// GameCube pad slot → host-button id. The GC `Z` button has no Xbox namesake;
/// it conventionally rides the right bumper.
const GC_BUTTONS: &[(&str, &str)] = &[
    ("Buttons/A", "a"),
    ("Buttons/B", "b"),
    ("Buttons/X", "x"),
    ("Buttons/Y", "y"),
    ("Buttons/Z", "rightBumper"),
    ("Buttons/Start", "start"),
    ("D-Pad/Up", "dpadUp"),
    ("D-Pad/Down", "dpadDown"),
    ("D-Pad/Left", "dpadLeft"),
    ("D-Pad/Right", "dpadRight"),
    ("Triggers/L", "leftTrigger"),
    ("Triggers/R", "rightTrigger"),
];

/// Sticks are fixed: Main = left stick, C = right stick.
const GC_STICKS: &[(&str, &str)] = &[
    ("Main Stick/Up", "Left Y+"),
    ("Main Stick/Down", "Left Y-"),
    ("Main Stick/Left", "Left X-"),
    ("Main Stick/Right", "Left X+"),
    ("C-Stick/Up", "Right Y+"),
    ("C-Stick/Down", "Right Y-"),
    ("C-Stick/Left", "Right X-"),
    ("C-Stick/Right", "Right X+"),
];

/// Author the Dolphin `[GCPad1]` block. Dolphin input values are backtick-quoted
/// (`` `Button A` ``); the device is the generic `XInput/0/Gamepad`, which binds
/// any XInput pad on Windows without needing the controller's GUID.
fn serialize_dolphin(text: &str, profile: &Profile) -> String {
    let mut kvs: Vec<(String, String)> = Vec::new();
    kvs.push(("Device".into(), "XInput/0/Gamepad".into()));
    for (slot, host_id) in GC_BUTTONS {
        let tok = dolphin_token(&profile.token_for(host_id));
        if !tok.is_empty() {
            kvs.push((slot.to_string(), format!("`{tok}`")));
        }
    }
    for (slot, axis) in GC_STICKS {
        kvs.push((slot.to_string(), format!("`{axis}`")));
    }
    ini::set_keys(text, "GCPad1", &kvs)
}

// ---------------------------------------------------------------------------
// RPCS3 (in-place YAML remap of Player 1 Input)
// ---------------------------------------------------------------------------

/// Translate an SDL token into the RPCS3 SDL-handler button value.
fn rpcs3_token(sdl: &str) -> &'static str {
    match sdl {
        "FaceSouth" => "South",
        "FaceEast" => "East",
        "FaceWest" => "West",
        "FaceNorth" => "North",
        "Back" => "Back",
        "Guide" => "Guide",
        "Start" => "Start",
        "LeftShoulder" => "LB",
        "RightShoulder" => "RB",
        "LeftTrigger" => "LT",
        "RightTrigger" => "RT",
        "LeftStick" => "LS",
        "RightStick" => "RS",
        "DPadUp" => "Up",
        "DPadDown" => "Down",
        "DPadLeft" => "Left",
        "DPadRight" => "Right",
        _ => "",
    }
}

/// RPCS3 `Player 1 Input` button key → host-button id.
const RPCS3_KEYS: &[(&str, &str)] = &[
    ("Cross", "a"),
    ("Circle", "b"),
    ("Square", "x"),
    ("Triangle", "y"),
    ("Select", "back"),
    ("Start", "start"),
    ("L1", "leftBumper"),
    ("R1", "rightBumper"),
    ("L2", "leftTrigger"),
    ("R2", "rightTrigger"),
    ("L3", "leftStick"),
    ("R3", "rightStick"),
    ("Up", "dpadUp"),
    ("Down", "dpadDown"),
    ("Left", "dpadLeft"),
    ("Right", "dpadRight"),
];

/// Remap the `Player 1 Input` block of an RPCS3 `Default.yml` in place. Only the
/// button values inside that one player's block are rewritten; the handler,
/// device, sticks, and every other player are preserved byte-for-byte. Returns
/// `Err` with a user-facing reason when there's no Player 1 block yet.
fn serialize_rpcs3(text: &str, profile: &Profile) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Launch RPCS3 and bind a controller once (Config → Pads), then Apply.".into());
    }
    let mut lines: Vec<String> = text.split('\n').map(|s| s.to_string()).collect();

    // Find the "Player 1 Input:" header and the indent it sits at.
    let is_player_header = |l: &str| {
        let t = l.trim_start();
        t.starts_with("Player ") && t.contains("Input:")
    };
    let start = match lines.iter().position(|l| {
        let t = l.trim_start();
        t.starts_with("Player 1 Input:")
    }) {
        Some(i) => i,
        None => return Err("No Player 1 controller config in RPCS3 yet — bind a pad once, then Apply.".into()),
    };
    // Block ends at the next player header (or EOF).
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| is_player_header(l))
        .map(|(i, _)| i)
        .unwrap_or(lines.len());

    for (key, host) in RPCS3_KEYS {
        let val = rpcs3_token(&profile.token_for(host));
        if val.is_empty() {
            continue;
        }
        for line in lines.iter_mut().take(end).skip(start + 1) {
            if let Some((indent, k)) = split_yaml_key(line) {
                if k == *key {
                    *line = format!("{indent}{key}: {val}");
                    break;
                }
            }
        }
    }
    Ok(lines.join("\n"))
}

/// Split a YAML `  Key: value` line into its leading whitespace and the key, or
/// None when the line isn't a `Key:` assignment. The key must match exactly (so
/// `Left:` is distinguished from `Left Stick Left:`).
fn split_yaml_key(line: &str) -> Option<(String, String)> {
    let indent_len = line.len() - line.trim_start().len();
    let indent = line[..indent_len].to_string();
    let rest = &line[indent_len..];
    let colon = rest.find(':')?;
    let key = rest[..colon].to_string();
    if key.is_empty() {
        return None;
    }
    Some((indent, key))
}

// ---------------------------------------------------------------------------
// Ryujinx (in-place JSON remap of input_config[0])
// ---------------------------------------------------------------------------

/// Translate an SDL token into the Ryujinx SDL2 gamepad button name.
fn ryujinx_token(sdl: &str) -> &'static str {
    match sdl {
        "FaceSouth" => "A",
        "FaceEast" => "B",
        "FaceWest" => "X",
        "FaceNorth" => "Y",
        "Back" => "Back",
        "Guide" => "Guide",
        "Start" => "Start",
        "LeftShoulder" => "LeftShoulder",
        "RightShoulder" => "RightShoulder",
        "LeftTrigger" => "LeftTrigger",
        "RightTrigger" => "RightTrigger",
        "LeftStick" => "LeftStick",
        "RightStick" => "RightStick",
        "DPadUp" => "DpadUp",
        "DPadDown" => "DpadDown",
        "DPadLeft" => "DpadLeft",
        "DPadRight" => "DpadRight",
        _ => "",
    }
}

/// `(json_object, field, host_id)` for every Ryujinx button we remap. The object
/// is the sub-table inside `input_config[0]` the field lives under.
const RYUJINX_FIELDS: &[(&str, &str, &str)] = &[
    ("right_joycon", "button_a", "a"),
    ("right_joycon", "button_b", "b"),
    ("right_joycon", "button_x", "x"),
    ("right_joycon", "button_y", "y"),
    ("right_joycon", "button_plus", "start"),
    ("right_joycon", "button_r", "rightBumper"),
    ("right_joycon", "button_zr", "rightTrigger"),
    ("left_joycon", "button_minus", "back"),
    ("left_joycon", "button_l", "leftBumper"),
    ("left_joycon", "button_zl", "leftTrigger"),
    ("left_joycon", "dpad_up", "dpadUp"),
    ("left_joycon", "dpad_down", "dpadDown"),
    ("left_joycon", "dpad_left", "dpadLeft"),
    ("left_joycon", "dpad_right", "dpadRight"),
];

/// Remap the first controller in a Ryujinx `Config.json` in place: rewrite each
/// known button field and the stick-click + dead-zone values, preserving the
/// device id/name/backend and everything else. Returns `Err` when there's no
/// controller configured yet (nothing to remap onto).
fn serialize_ryujinx(text: &str, profile: &Profile) -> Result<String, String> {
    let mut root: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "Ryujinx config isn't readable yet — set a controller up once, then Apply.".to_string())?;

    let configs = root
        .get_mut("input_config")
        .and_then(|v| v.as_array_mut())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| "No controller configured in Ryujinx yet — set one up once, then Apply.".to_string())?;

    let entry = &mut configs[0];

    for (obj, field, host) in RYUJINX_FIELDS {
        let tok = ryujinx_token(&profile.token_for(host));
        if tok.is_empty() {
            continue;
        }
        if let Some(target) = entry.get_mut(obj).and_then(|o| o.get_mut(field)) {
            *target = serde_json::Value::String(tok.to_string());
        }
    }
    // Stick clicks live on the per-stick objects.
    if let Some(b) = entry.get_mut("left_joycon_stick").and_then(|o| o.get_mut("stick_button")) {
        *b = serde_json::Value::String(ryujinx_token(&profile.token_for("leftStick")).to_string());
    }
    if let Some(b) = entry.get_mut("right_joycon_stick").and_then(|o| o.get_mut("stick_button")) {
        *b = serde_json::Value::String(ryujinx_token(&profile.token_for("rightStick")).to_string());
    }
    // Dead zone is a 0..1 float, matching our model's scale.
    if let Some(n) = serde_json::Number::from_f64(profile.dead_zone as f64) {
        for k in ["deadzone_left", "deadzone_right"] {
            if let Some(d) = entry.get_mut(k) {
                *d = serde_json::Value::Number(n.clone());
            }
        }
    }

    serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Ryujinx config re-encode failed: {e}"))
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Apply `profile` to an emulator config's `text`, returning the new file text.
/// Pure — no disk access. `Err` carries a user-facing reason when an in-place
/// format has no existing config to remap (RPCS3 / Ryujinx).
pub fn serialize(fmt: NativeFormat, text: &str, profile: &Profile) -> Result<String, String> {
    match fmt {
        NativeFormat::Pcsx2 | NativeFormat::DuckStation => Ok(serialize_stenzek(fmt, text, profile)),
        NativeFormat::Dolphin => Ok(serialize_dolphin(text, profile)),
        NativeFormat::Rpcs3 => serialize_rpcs3(text, profile),
        NativeFormat::Ryujinx => serialize_ryujinx(text, profile),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_maps_to_format() {
        assert_eq!(native_format("pcsx2-windows"), Some(NativeFormat::Pcsx2));
        assert_eq!(native_format("DuckStation"), Some(NativeFormat::DuckStation));
        assert_eq!(native_format("dolphin-x64"), Some(NativeFormat::Dolphin));
        assert_eq!(native_format("rpcs3-win64"), Some(NativeFormat::Rpcs3));
        assert_eq!(native_format("ryujinx-win-x64"), Some(NativeFormat::Ryujinx));
        // Auto-bind emulators have no native writer.
        assert_eq!(native_format("xemu"), None);
        assert_eq!(native_format("xenia-canary"), None);
        assert_eq!(native_format("mesen"), None);
        assert_eq!(native_format("gopher64"), None);
    }

    #[test]
    fn platform_covers_every_shipped_emulator() {
        assert_eq!(platform_for("pcsx2"), Some("ps2"));
        assert_eq!(platform_for("dolphin"), Some("gamecube"));
        assert_eq!(platform_for("rpcs3"), Some("ps3"));
        assert_eq!(platform_for("ryujinx"), Some("switch"));
        assert_eq!(platform_for("xemu"), Some("xbox"));
        assert_eq!(platform_for("xenia-canary"), Some("xbox360"));
        assert_eq!(platform_for("mesen"), Some("nes"));
        assert_eq!(platform_for("gopher64"), Some("n64"));
        assert_eq!(platform_for("unknown"), None);
    }

    #[test]
    fn pcsx2_default_profile_matches_ground_truth_tokens() {
        let out = serialize(NativeFormat::Pcsx2, "", &Profile::default()).unwrap();
        assert!(out.contains("[InputSources]"));
        assert!(out.contains("SDL = true"));
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
        assert!(out.contains("LLeft = SDL-0/-LeftX"));
        assert!(out.contains("RRight = SDL-0/+RightX"));
        assert!(out.contains("Deadzone = 0.15"));
    }

    #[test]
    fn duckstation_uses_analog_type_and_no_deadzone_key() {
        let out = serialize(NativeFormat::DuckStation, "", &Profile::default()).unwrap();
        assert!(out.contains("Type = AnalogController"));
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        assert!(!out.contains("Deadzone ="));
    }

    #[test]
    fn remap_swaps_face_buttons() {
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into());
        p.bindings.insert("b".into(), "FaceSouth".into());
        let out = serialize(NativeFormat::Pcsx2, "", &p).unwrap();
        assert!(out.contains("Cross = SDL-0/FaceEast"));
        assert!(out.contains("Circle = SDL-0/FaceSouth"));
    }

    #[test]
    fn preserves_unrelated_sections() {
        let text = "[EmuCore]\nEnableCheats = true\n\n[Pad1]\nType = Keyboard\nCross = Keyboard/X\n";
        let out = serialize(NativeFormat::Pcsx2, text, &Profile::default()).unwrap();
        assert!(out.contains("[EmuCore]"));
        assert!(out.contains("EnableCheats = true"));
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        assert!(!out.contains("Keyboard/X"));
    }

    #[test]
    fn dolphin_authors_xinput_gcpad() {
        let out = serialize(NativeFormat::Dolphin, "", &Profile::default()).unwrap();
        assert!(out.contains("[GCPad1]"));
        assert!(out.contains("Device = XInput/0/Gamepad"));
        assert!(out.contains("Buttons/A = `Button A`"));
        assert!(out.contains("Buttons/Z = `Shoulder R`")); // Z rides right bumper
        assert!(out.contains("D-Pad/Up = `Pad N`"));
        assert!(out.contains("Triggers/L = `Trigger L`"));
        assert!(out.contains("Main Stick/Up = `Left Y+`"));
        assert!(out.contains("C-Stick/Right = `Right X+`"));
    }

    #[test]
    fn dolphin_remap_swaps_a_and_b() {
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into());
        let out = serialize(NativeFormat::Dolphin, "", &p).unwrap();
        // GC A is fed by host A → now FaceEast → Button B.
        assert!(out.contains("Buttons/A = `Button B`"));
    }

    #[test]
    fn rpcs3_remaps_player_one_in_place() {
        let text = "\
Player 1 Input:
  Handler: SDL
  Device: Xbox Series X Controller 1
  Config:
    Cross: South
    Circle: East
    Left Stick Left: LS X-
    Up: Up
Player 2 Input:
  Handler: Null
  Config:
    Cross: South
";
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into()); // Cross now driven by FaceEast → East
        let out = serialize(NativeFormat::Rpcs3, text, &p).unwrap();
        // Player 1 Cross updated; handler/device preserved.
        assert!(out.contains("Handler: SDL"));
        assert!(out.contains("Device: Xbox Series X Controller 1"));
        assert!(out.contains("    Cross: East"));
        // The exact "Left Stick Left" key is NOT clobbered by the "Left" remap.
        assert!(out.contains("    Left Stick Left: LS X-"));
        // Player 2's Cross is untouched (still South).
        let p2 = out.split("Player 2 Input:").nth(1).unwrap();
        assert!(p2.contains("Cross: South"));
    }

    #[test]
    fn rpcs3_errors_without_player_one() {
        assert!(serialize(NativeFormat::Rpcs3, "", &Profile::default()).is_err());
        assert!(serialize(NativeFormat::Rpcs3, "Player 2 Input:\n  Handler: Null\n", &Profile::default()).is_err());
    }

    #[test]
    fn ryujinx_remaps_existing_controller() {
        let text = r#"{
  "input_config": [
    {
      "left_joycon_stick": { "stick_button": "LeftStick" },
      "right_joycon_stick": { "stick_button": "RightStick" },
      "deadzone_left": 0.1,
      "deadzone_right": 0.1,
      "left_joycon": { "button_minus": "Back", "dpad_up": "DpadUp" },
      "right_joycon": { "button_a": "A", "button_b": "B" },
      "id": "0-00000003-045e-0000-e002-000000007200",
      "backend": "GamepadSDL2"
    }
  ],
  "other_setting": true
}"#;
        let mut p = Profile::default();
        p.bindings.insert("a".into(), "FaceEast".into()); // Switch A now FaceEast → "B"
        p.dead_zone = 0.2;
        let out = serialize(NativeFormat::Ryujinx, text, &p).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let e = &v["input_config"][0];
        assert_eq!(e["right_joycon"]["button_a"], "B");
        assert_eq!(e["right_joycon"]["button_b"], "B"); // host b still FaceEast → B
        // Device id and unrelated settings preserved.
        assert_eq!(e["id"], "0-00000003-045e-0000-e002-000000007200");
        assert_eq!(v["other_setting"], true);
        // Dead zone applied to both sticks.
        assert_eq!(e["deadzone_left"].as_f64().unwrap(), 0.2_f32 as f64);
        assert_eq!(e["deadzone_right"].as_f64().unwrap(), 0.2_f32 as f64);
    }

    #[test]
    fn ryujinx_errors_without_controller() {
        assert!(serialize(NativeFormat::Ryujinx, "", &Profile::default()).is_err());
        assert!(serialize(NativeFormat::Ryujinx, r#"{"input_config":[]}"#, &Profile::default()).is_err());
    }
}
