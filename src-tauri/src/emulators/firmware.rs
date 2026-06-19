//! Deploy server-staged BIOS / firmware into each emulator's expected location.
//!
//! The download layer mirrors the server's firmware blobs into the emulators
//! data dir (`<app_data>/emulators/`): `scph1001.bin` (PS1 BIOS), the
//! `xemu-firmware/` dir (OG Xbox `bios.bin` / `mcpx.bin` / `hdd.qcow2`), and
//! `PS3UPDAT.PUP` (PS3 firmware). An emulator only *uses* its firmware once it's
//! in the right place and its config points at it. This module is that last
//! step, mirroring the native client's `AssetEnsure` self-heal:
//!
//!   * DuckStation — copy `scph1001.bin` into `<exe>/bios/` and point
//!     `settings.ini`'s `[BIOS]` section at it (portable mode).
//!   * xemu        — write `xemu.toml` so it boots from the staged firmware
//!     blobs directly (the ~1 GB HDD image is never copied).
//!   * RPCS3       — install `PS3UPDAT.PUP` headlessly via `--installfw`, guarded
//!     by a `dev_flash` marker so it only ever runs once.
//!
//! Everything here is best-effort and idempotent: a missing emulator, a not-yet
//! staged blob, or a single failure never aborts the rest — it just records a
//! line in the returned log. The TOML/INI editors are pure and unit-tested.

use crate::controller::ini;
use crate::emulators::launch;
use std::path::Path;
use std::process::Command;

/// True if `key = …` is assigned anywhere in `doc` (any section).
fn toml_has(doc: &str, key: &str) -> bool {
    doc.lines().any(|line| {
        let t = line.trim_start();
        t.strip_prefix(key)
            .map(|rest| rest.trim_start().starts_with('='))
            .unwrap_or(false)
    })
}

/// Set `key = 'value'` under `[section]`, replacing an existing assignment in
/// place or creating the section/key as needed. Single-quoted TOML literal
/// strings so Windows backslash paths need no escaping. Mirrors the native
/// client's minimal `TomlSet` (tuned to xemu's flat layout).
fn toml_set(doc: &str, section: &str, key: &str, value: &str) -> String {
    let new_line = format!("{key} = '{value}'");
    let header = format!("[{section}]");
    let mut lines: Vec<String> = doc.split('\n').map(|s| s.to_string()).collect();

    // Find the section's line span: from its header to the next header (or EOF).
    let mut sec_start: Option<usize> = None;
    let mut sec_end = lines.len();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        match sec_start {
            None => {
                if t == header {
                    sec_start = Some(i);
                }
            }
            Some(_) => {
                if t.starts_with('[') {
                    sec_end = i;
                    break;
                }
            }
        }
    }

    let Some(start) = sec_start else {
        // No such section — append it at EOF.
        let mut out = doc.to_string();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&header);
        out.push('\n');
        out.push_str(&new_line);
        out.push('\n');
        return out;
    };

    // Replace the key in place if it already exists within the section.
    for line in lines.iter_mut().take(sec_end).skip(start + 1) {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix(key) {
            if rest.trim_start().starts_with('=') {
                *line = new_line;
                return lines.join("\n");
            }
        }
    }

    // Otherwise insert it as the section's first key.
    lines.insert(start + 1, new_line);
    lines.join("\n")
}

/// Read a file to a string, returning empty when it's missing (so a first run
/// with no config yet is not an error).
fn read_or_empty(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Atomic text write (temp + rename), creating the parent dir.
fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp-firmware");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

/// Deploy the PS1 BIOS into DuckStation: copy `scph1001.bin` into the portable
/// `bios/` dir (non-destructive) and point `settings.ini`'s `[BIOS]` section at
/// it. `exe` is the DuckStation executable; `staging` is the emulators data dir.
fn deploy_duckstation_bios(exe: &Path, staging: &Path) -> String {
    let Some(exe_dir) = exe.parent() else {
        return "DuckStation: bad exe path".into();
    };
    let src = staging.join("scph1001.bin");
    if !src.is_file() {
        return "DuckStation: scph1001.bin not staged".into();
    }
    let bios_dir = exe_dir.join("bios");
    let dest = bios_dir.join("scph1001.bin");
    if !dest.exists() {
        if let Err(e) = std::fs::create_dir_all(&bios_dir).and_then(|_| std::fs::copy(&src, &dest).map(|_| ())) {
            return format!("DuckStation: BIOS copy failed: {e}");
        }
    }

    // Portable marker so DuckStation reads settings.ini from its own dir.
    let marker = exe_dir.join("portable.txt");
    if !marker.exists() {
        let _ = std::fs::write(&marker, b"");
    }
    // Point the [BIOS] section at the copied dump for every region.
    let ini_path = exe_dir.join("settings.ini");
    let text = read_or_empty(&ini_path);
    let updated = ini::set_keys(
        &text,
        "BIOS",
        &[
            ("SearchDirectory".into(), "bios".into()),
            ("PathNTSC-U".into(), "scph1001.bin".into()),
            ("PathNTSC-J".into(), "scph1001.bin".into()),
            ("PathPAL".into(), "scph1001.bin".into()),
        ],
    );
    if let Err(e) = write_atomic(&ini_path, &updated) {
        return format!("DuckStation: settings.ini write failed: {e}");
    }
    "DuckStation: PS1 BIOS deployed".into()
}

/// Deploy OG Xbox firmware for xemu: write `xemu.toml` so it boots from the
/// staged firmware blobs in place (no copy — the HDD image is ~1 GB). The config
/// lives in xemu's roaming dir, matching the native client.
fn deploy_xemu_firmware(staging: &Path, appdata: Option<&str>) -> String {
    let fw_dir = staging.join("xemu-firmware");
    let mcpx = fw_dir.join("mcpx.bin");
    let bios = fw_dir.join("bios.bin");
    let hdd = fw_dir.join("hdd.qcow2");
    if !(mcpx.is_file() && bios.is_file() && hdd.is_file()) {
        return "xemu: firmware not staged".into();
    }
    let Some(appdata) = appdata else {
        return "xemu: APPDATA not set".into();
    };
    let cfg_dir = Path::new(appdata).join("xemu").join("xemu");
    let toml_path = cfg_dir.join("xemu.toml");

    let mut doc = read_or_empty(&toml_path);
    doc = toml_set(&doc, "sys.files", "bootrom_path", &mcpx.to_string_lossy());
    doc = toml_set(&doc, "sys.files", "flashrom_path", &bios.to_string_lossy());
    doc = toml_set(&doc, "sys.files", "hdd_path", &hdd.to_string_lossy());
    // Leave any existing EEPROM untouched; only default a path when unset.
    if !toml_has(&doc, "eeprom_path") {
        let eeprom = cfg_dir.join("eeprom.bin");
        doc = toml_set(&doc, "sys.files", "eeprom_path", &eeprom.to_string_lossy());
    }
    if let Err(e) = write_atomic(&toml_path, &doc) {
        return format!("xemu: xemu.toml write failed: {e}");
    }
    "xemu: firmware config deployed".into()
}

/// Install PS3 firmware into RPCS3 headlessly. No-op when `dev_flash` is already
/// populated (the one-time marker) or the PUP isn't staged. `exe` is rpcs3.
fn deploy_rpcs3_firmware(exe: &Path, staging: &Path) -> String {
    let Some(exe_dir) = exe.parent() else {
        return "RPCS3: bad exe path".into();
    };
    let marker = exe_dir.join("dev_flash").join("vsh").join("etc").join("version.txt");
    if marker.exists() {
        return "RPCS3: firmware already installed".into();
    }
    let pup = staging.join("PS3UPDAT.PUP");
    if !pup.is_file() {
        return "RPCS3: PS3UPDAT.PUP not staged".into();
    }
    // `--installfw` runs headless and exits; bound the wait so a hung install
    // can't pin the background thread forever.
    let child = Command::new(exe).arg("--installfw").arg(&pup).spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return format!("RPCS3: launch failed: {e}"),
    };
    let deadline_secs = 5 * 60;
    for _ in 0..deadline_secs {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => std::thread::sleep(std::time::Duration::from_secs(1)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    if marker.exists() {
        "RPCS3: PS3 firmware installed".into()
    } else {
        "RPCS3: firmware install did not complete".into()
    }
}

/// Deploy every staged firmware blob into the emulators that are installed. Best
/// effort: returns a human-readable line per emulator considered (skips ones not
/// installed). Safe to call repeatedly — each step is idempotent.
pub fn ensure_all(app: &tauri::AppHandle) -> Vec<String> {
    let mut log = Vec::new();
    let Some(emu_dir) = launch::emulators_dir(app) else {
        return log;
    };
    let runtimes = emu_dir.join("_runtimes");

    if let Some(exe) = launch::find_exe(&runtimes, launch::exe_candidates("ps1")) {
        log.push(deploy_duckstation_bios(&exe, &emu_dir));
    }
    if launch::find_exe(&runtimes, launch::exe_candidates("xbox")).is_some() {
        log.push(deploy_xemu_firmware(&emu_dir, std::env::var("APPDATA").ok().as_deref()));
    }
    if let Some(exe) = launch::find_exe(&runtimes, launch::exe_candidates("ps3")) {
        log.push(deploy_rpcs3_firmware(&exe, &emu_dir));
    }
    log
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toml_set_creates_section_and_key() {
        let out = toml_set("", "sys.files", "bootrom_path", "C:\\fw\\mcpx.bin");
        assert!(out.contains("[sys.files]"));
        assert!(out.contains("bootrom_path = 'C:\\fw\\mcpx.bin'"));
    }

    #[test]
    fn toml_set_replaces_existing_key_in_place() {
        let doc = "[sys.files]\nbootrom_path = 'old'\nhdd_path = 'h'\n";
        let out = toml_set(doc, "sys.files", "bootrom_path", "new");
        assert!(out.contains("bootrom_path = 'new'"));
        assert!(!out.contains("'old'"));
        // Sibling key untouched.
        assert!(out.contains("hdd_path = 'h'"));
    }

    #[test]
    fn toml_set_adds_key_to_existing_section() {
        let doc = "[sys.files]\nbootrom_path = 'b'\n\n[general]\nshow_welcome = false\n";
        let out = toml_set(doc, "sys.files", "flashrom_path", "f");
        assert!(out.contains("flashrom_path = 'f'"));
        // Didn't leak into [general].
        let general_idx = out.find("[general]").unwrap();
        assert!(out.find("flashrom_path").unwrap() < general_idx);
        assert!(out.contains("show_welcome = false"));
    }

    #[test]
    fn toml_has_detects_assignment_anywhere() {
        let doc = "[sys.files]\neeprom_path = 'e'\n";
        assert!(toml_has(doc, "eeprom_path"));
        assert!(!toml_has(doc, "missing_key"));
        // A key only as a substring of another isn't a match.
        assert!(!toml_has("[s]\nfoobar = '1'\n", "foo"));
    }

    #[test]
    fn duckstation_not_staged_is_reported() {
        let staging = std::env::temp_dir().join(format!("fw_ds_{}", std::process::id()));
        std::fs::create_dir_all(&staging).unwrap();
        let exe = staging.join("duckstation.exe");
        std::fs::write(&exe, b"x").unwrap();
        let msg = deploy_duckstation_bios(&exe, &staging);
        assert!(msg.contains("not staged"), "{msg}");
        std::fs::remove_dir_all(&staging).ok();
    }

    #[test]
    fn duckstation_copies_bios_and_points_ini() {
        let staging = std::env::temp_dir().join(format!("fw_ds2_{}", std::process::id()));
        let exe_dir = staging.join("rt");
        std::fs::create_dir_all(&exe_dir).unwrap();
        std::fs::write(staging.join("scph1001.bin"), b"biosdata").unwrap();
        let exe = exe_dir.join("duckstation.exe");
        std::fs::write(&exe, b"x").unwrap();

        let msg = deploy_duckstation_bios(&exe, &staging);
        assert!(msg.contains("deployed"), "{msg}");
        assert!(exe_dir.join("bios").join("scph1001.bin").is_file());
        let ini = std::fs::read_to_string(exe_dir.join("settings.ini")).unwrap();
        assert!(ini.contains("[BIOS]"));
        assert!(ini.contains("SearchDirectory = bios"));
        assert!(ini.contains("PathNTSC-U = scph1001.bin"));
        std::fs::remove_dir_all(&staging).ok();
    }

    #[test]
    fn xemu_writes_toml_pointing_at_staged_blobs() {
        let staging = std::env::temp_dir().join(format!("fw_xemu_{}", std::process::id()));
        let fw = staging.join("xemu-firmware");
        std::fs::create_dir_all(&fw).unwrap();
        for f in ["mcpx.bin", "bios.bin", "hdd.qcow2"] {
            std::fs::write(fw.join(f), b"x").unwrap();
        }
        let appdata = staging.join("appdata");
        std::fs::create_dir_all(&appdata).unwrap();

        let msg = deploy_xemu_firmware(&staging, appdata.to_str());
        assert!(msg.contains("deployed"), "{msg}");
        let toml = std::fs::read_to_string(appdata.join("xemu").join("xemu").join("xemu.toml")).unwrap();
        assert!(toml.contains("[sys.files]"));
        assert!(toml.contains("bootrom_path"));
        assert!(toml.contains("mcpx.bin"));
        assert!(toml.contains("eeprom_path")); // defaulted since absent
        std::fs::remove_dir_all(&staging).ok();
    }
}
