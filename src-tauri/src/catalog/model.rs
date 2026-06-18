//! The `Game` data model — a UTF-8 mirror of the entries `GameLibrary::Save`
//! writes to `library.json`. Field names and casing match the on-disk format
//! exactly (verified against the C++ client's Catalog reader), so the same
//! `library.json` loads in both clients during the migration.

use serde::{Deserialize, Serialize};

/// One library entry. Unknown/missing fields default, so older or newer
/// `library.json` files still load instead of failing the whole catalog.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Game {
    pub id: String,
    pub title: String,
    pub platform: String,
    /// "installed" | "notInstalled" | "updateAvailable" | …
    pub install_state: String,

    // ── Art ────────────────────────────────────────────────────────────────
    pub cover_art_path: String,
    pub cover_art_url: String,

    // ── Metadata ─────────────────────────────────────────────────────────────
    pub developer: String,
    pub publisher: String,
    pub franchise: String,
    pub genres: String,
    pub content_path: String,
    pub release_date: i64,
    pub playtime_seconds: u64,
    pub last_played: i64,
    /// IGDB rating 0–100 (0 = unrated). Used for the rating sort + detail panel.
    pub igdb_rating: f64,
    pub summary: String,
    pub server_backed: bool,
    pub favorite: bool,
    pub hidden: bool,
    /// Newline-joined in the JSON; split lazily by the UI when needed.
    pub collections: String,

    // ── Launch target (mirrors GameLibrary::LaunchTarget precedence) ─────────
    pub launch_uri: String,
    pub exe_path: String,
    pub emulator_path: String,
    pub rom_path: String,
    pub arguments: String,

    // ── Launch hooks (Playnite-style; run hidden, failures ignored) ──────────
    pub launch_options: String,
    pub pre_launch_cmd: String,
    pub post_exit_cmd: String,
}

/// What to run, resolved with the same precedence as the C++ client:
/// launchUri → emulatorPath(+romPath) → exePath(+arguments).
pub struct LaunchPlan {
    pub program: String,
    pub args: Vec<String>,
}

impl Game {
    /// Build the launch plan, or `None` if the entry has no runnable target.
    pub fn launch_plan(&self) -> Option<LaunchPlan> {
        if !self.launch_uri.is_empty() {
            return Some(LaunchPlan { program: self.launch_uri.clone(), args: vec![] });
        }
        if !self.emulator_path.is_empty() {
            return Some(LaunchPlan {
                program: self.emulator_path.clone(),
                args: emulator_args(&self.arguments, &self.rom_path),
            });
        }
        if !self.exe_path.is_empty() {
            return Some(LaunchPlan {
                program: self.exe_path.clone(),
                args: split_args(&self.arguments),
            });
        }
        None
    }
}

/// Build an emulator's argument vector from its server-provided `arguments`
/// template and the resolved local `rom` path. The template carries a `{rom}`
/// placeholder (most emulators take the ROM as a bare positional arg; xemu/Xbox
/// use `-dvd_path {rom}`). We split the template into tokens FIRST, then
/// substitute `{rom}` inside whichever token holds it — so a ROM path with
/// spaces stays a single argument instead of being re-split. An empty template
/// falls back to passing the ROM as the sole positional argument.
fn emulator_args(template: &str, rom: &str) -> Vec<String> {
    if template.trim().is_empty() {
        return if rom.is_empty() { vec![] } else { vec![rom.to_string()] };
    }
    split_args(template)
        .into_iter()
        .map(|t| if t.contains("{rom}") { t.replace("{rom}", rom) } else { t })
        .collect()
}

/// Minimal whitespace arg split (quotes respected). Good enough for T0; a
/// fuller parser can replace this without touching callers.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote = false;
    for c in s.chars() {
        match c {
            '"' => in_quote = !in_quote,
            ' ' if !in_quote => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_precedence_uri_wins() {
        let g = Game {
            launch_uri: "steam://run/220".into(),
            exe_path: "ignored.exe".into(),
            ..Default::default()
        };
        let p = g.launch_plan().unwrap();
        assert_eq!(p.program, "steam://run/220");
        assert!(p.args.is_empty());
    }

    #[test]
    fn launch_emulator_passes_rom() {
        // No template → ROM is the sole positional arg.
        let g = Game {
            emulator_path: "/usr/bin/mednafen".into(),
            rom_path: "/roms/crystalis.nes".into(),
            ..Default::default()
        };
        let p = g.launch_plan().unwrap();
        assert_eq!(p.program, "/usr/bin/mednafen");
        assert_eq!(p.args, vec!["/roms/crystalis.nes"]);
    }

    #[test]
    fn launch_emulator_substitutes_rom_template() {
        // xemu-style flagged template; ROM path has a space and must stay one arg.
        let g = Game {
            emulator_path: "xemu.exe".into(),
            rom_path: "C:/games/Halo 2.iso".into(),
            arguments: "-dvd_path {rom}".into(),
            ..Default::default()
        };
        let p = g.launch_plan().unwrap();
        assert_eq!(p.program, "xemu.exe");
        assert_eq!(p.args, vec!["-dvd_path", "C:/games/Halo 2.iso"]);
    }

    #[test]
    fn launch_emulator_bare_rom_template() {
        let g = Game {
            emulator_path: "Ryujinx.exe".into(),
            rom_path: "C:/games/zelda.nsp".into(),
            arguments: "{rom}".into(),
            ..Default::default()
        };
        let p = g.launch_plan().unwrap();
        assert_eq!(p.args, vec!["C:/games/zelda.nsp"]);
    }

    #[test]
    fn launch_exe_splits_quoted_args() {
        let g = Game {
            exe_path: "game.exe".into(),
            arguments: "-w \"save dir\" -fast".into(),
            ..Default::default()
        };
        let p = g.launch_plan().unwrap();
        assert_eq!(p.program, "game.exe");
        assert_eq!(p.args, vec!["-w", "save dir", "-fast"]);
    }

    #[test]
    fn no_target_is_none() {
        assert!(Game::default().launch_plan().is_none());
    }
}
