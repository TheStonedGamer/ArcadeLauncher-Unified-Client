//! Tauri command layer for the per-emulator controller remap editor.
//!
//! The pure cores live in sibling modules: `model` (the host-button → SDL-token
//! profile + its persisted collection), `serializers` (native config writers),
//! `bios` (copy-install staged BIOS). This file is the only place that touches
//! the app's data dirs: it lists what the UI needs, persists profiles to
//! `controller_profiles.json`, and on *apply* resolves the installed emulator's
//! config path, backs it up, writes the new pad config atomically, and places
//! any staged BIOS. Resolution mirrors `emulators::launch`: the emulator exe is
//! found under the unpacked runtimes root, and its config/bios dirs hang off the
//! exe dir in portable mode (which we enable with the emulator's marker file).

use crate::controller::{bios, model, serializers};
use crate::emulators::launch;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// A rebindable host button, for the editor grid.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostButtonDto {
    pub id: String,
    pub label: String,
    pub default_token: String,
}

/// List every rebindable host button in display order.
#[tauri::command]
pub fn controller_host_buttons() -> Vec<HostButtonDto> {
    model::HOST_BUTTONS
        .iter()
        .map(|b| HostButtonDto {
            id: b.id.to_string(),
            label: b.label.to_string(),
            default_token: b.default_token.to_string(),
        })
        .collect()
}

/// The SDL input tokens a host button may be bound to (dropdown options).
#[tauri::command]
pub fn controller_sdl_tokens() -> Vec<String> {
    model::SDL_BUTTON_TOKENS.iter().map(|s| s.to_string()).collect()
}

/// An emulator the editor can target, with whether we can write its native pad
/// config and whether its runtime is installed locally.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerTargetDto {
    pub id: String,
    pub name: String,
    /// True when a validated native serializer exists (config gets applied to disk).
    pub native_writer: bool,
    /// True when the emulator runtime exe is present locally (apply can run now).
    pub installed: bool,
}

/// The emulators the remap editor offers. Today only the two validated native
/// targets (PCSX2 / DuckStation); profiles for others could persist but aren't
/// written to disk, so we don't surface them yet.
#[tauri::command]
pub fn controller_targets(app: tauri::AppHandle) -> Vec<ControllerTargetDto> {
    let targets = [("pcsx2", "PCSX2 (PS2)"), ("duckstation", "DuckStation (PS1)")];
    targets
        .iter()
        .map(|(id, name)| ControllerTargetDto {
            id: id.to_string(),
            name: name.to_string(),
            native_writer: serializers::native_format(id).is_some(),
            installed: resolve_exe(&app, id).is_some(),
        })
        .collect()
}

/// Profiles file path: `<app_config>/controller_profiles.json`, alongside the
/// other client-local stores (settings, install records).
fn profiles_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::msg(format!("no config dir: {e}")))?;
    Ok(dir.join("controller_profiles.json"))
}

/// Load every saved per-emulator profile.
#[tauri::command]
pub fn controller_load_profiles(app: tauri::AppHandle) -> AppResult<model::Profiles> {
    model::load(&profiles_path(&app)?)
}

/// Save (insert or replace) one emulator's profile, then return the full set so
/// the UI can refresh from a single source of truth.
#[tauri::command]
pub fn controller_save_profile(
    app: tauri::AppHandle,
    emulator_id: String,
    profile: model::Profile,
) -> AppResult<model::Profiles> {
    let path = profiles_path(&app)?;
    let mut store = model::load(&path)?;
    store.set(&emulator_id, profile);
    model::save(&path, &store)?;
    Ok(store)
}

/// Locate an emulator's runtime exe under the unpacked runtimes root, using the
/// same platform candidate list the launcher uses.
fn resolve_exe(app: &tauri::AppHandle, emulator_id: &str) -> Option<PathBuf> {
    let platform = match serializers::native_format(emulator_id)? {
        serializers::NativeFormat::Pcsx2 => "ps2",
        serializers::NativeFormat::DuckStation => "ps1",
    };
    let candidates = launch::exe_candidates(platform);
    let runtimes_root = launch::emulators_dir(app)?.join("_runtimes");
    launch::find_exe(&runtimes_root, candidates)
}

/// Resolve the config file path for an installed emulator, enabling portable
/// mode (so the emulator reads config from its own dir, not roaming AppData).
/// Returns `(config_path, bios_dir)`.
fn config_and_bios(
    fmt: serializers::NativeFormat,
    exe_dir: &Path,
) -> AppResult<(PathBuf, PathBuf)> {
    match fmt {
        serializers::NativeFormat::Pcsx2 => {
            // PCSX2 portable mode: a `portable.ini` marker next to the exe; its
            // config lives under `inis/PCSX2.ini`.
            let marker = exe_dir.join("portable.ini");
            if !marker.exists() {
                std::fs::write(&marker, b"")?;
            }
            let inis = exe_dir.join("inis");
            std::fs::create_dir_all(&inis)?;
            Ok((inis.join("PCSX2.ini"), exe_dir.join("bios")))
        }
        serializers::NativeFormat::DuckStation => {
            // DuckStation portable mode: a `portable.txt` marker; config is
            // `settings.ini` next to the exe.
            let marker = exe_dir.join("portable.txt");
            if !marker.exists() {
                std::fs::write(&marker, b"")?;
            }
            Ok((exe_dir.join("settings.ini"), exe_dir.join("bios")))
        }
    }
}

/// What `controller_apply` did, surfaced to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    /// True when the native pad config was written to disk.
    pub applied: bool,
    /// The config file written (empty when not applied).
    pub config_path: String,
    /// The backup of the prior config, if one existed.
    pub backup_path: Option<String>,
    /// Per-BIOS placement outcomes (human-readable).
    pub bios_messages: Vec<String>,
    /// Why apply didn't write, when `applied` is false.
    pub note: Option<String>,
}

/// Apply the saved profile for `emulator_id` to the installed emulator's native
/// config (and place any staged BIOS). The profile is persisted separately via
/// `controller_save_profile`; this reads the saved one (falling back to the
/// identity default) so "Save" and "Apply" are independent actions.
#[tauri::command]
pub fn controller_apply(app: tauri::AppHandle, emulator_id: String) -> AppResult<ApplyReport> {
    let Some(fmt) = serializers::native_format(&emulator_id) else {
        return Ok(ApplyReport {
            applied: false,
            config_path: String::new(),
            backup_path: None,
            bios_messages: vec![],
            note: Some(format!("No native controller writer for '{emulator_id}'.")),
        });
    };

    let Some(exe) = resolve_exe(&app, &emulator_id) else {
        return Ok(ApplyReport {
            applied: false,
            config_path: String::new(),
            backup_path: None,
            bios_messages: vec![],
            note: Some(format!("{emulator_id} is not installed yet.")),
        });
    };
    let exe_dir = exe
        .parent()
        .ok_or_else(|| AppError::msg("emulator exe has no parent dir"))?;

    let profile = model::load(&profiles_path(&app)?)?.get_or_default(&emulator_id);
    let (config_path, bios_dir) = config_and_bios(fmt, exe_dir)?;

    // Read existing config (empty when the emulator hasn't created one yet — the
    // serializer fills a complete `[Pad1]`, and the emulator defaults the rest).
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();

    // Back up a non-empty prior config before overwriting it.
    let backup_path = if !existing.trim().is_empty() {
        let bak = config_path.with_extension("ini.bak");
        std::fs::write(&bak, &existing)?;
        Some(bak.to_string_lossy().into_owned())
    } else {
        None
    };

    let new_text = serializers::serialize(fmt, &existing, &profile);

    // Atomic write (temp + rename), mirroring the JSON stores.
    if let Some(dir) = config_path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = config_path.with_extension("ini.tmp");
    std::fs::write(&tmp, &new_text)?;
    std::fs::rename(&tmp, &config_path)?;

    // Best-effort BIOS placement from the staging dir (the emulators data dir).
    let mut bios_messages = Vec::new();
    if let Some(staging) = launch::emulators_dir(&app) {
        let jobs = match fmt {
            serializers::NativeFormat::DuckStation => bios::plan(bios_dir.clone(), PathBuf::new()),
            serializers::NativeFormat::Pcsx2 => bios::plan(PathBuf::new(), bios_dir.clone()),
        };
        let want = match fmt {
            serializers::NativeFormat::DuckStation => "DuckStation",
            serializers::NativeFormat::Pcsx2 => "PCSX2",
        };
        for job in jobs.iter().filter(|j| j.emulator == want) {
            let msg = match bios::place(&staging, job) {
                bios::Placement::Placed(m)
                | bios::Placement::AlreadyPresent(m)
                | bios::Placement::NotStaged(m)
                | bios::Placement::Failed(m) => m,
            };
            bios_messages.push(msg);
        }
    }

    Ok(ApplyReport {
        applied: true,
        config_path: config_path.to_string_lossy().into_owned(),
        backup_path,
        bios_messages,
        note: None,
    })
}
