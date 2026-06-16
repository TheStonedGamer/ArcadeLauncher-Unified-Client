//! Pure global-hotkey core. OS/IO-free so it is exhaustively unit-tested: it
//! parses and canonicalises a user-typed accelerator like "ctrl + shift+g" into
//! a stable "Ctrl+Shift+G" form, rejecting nonsense (no key, modifier-only,
//! unknown token). The thin glue in `register` hands the canonical string to
//! `tauri-plugin-global-shortcut` and toggles the window on press.

/// The default summon/hide accelerator when the user hasn't set one but enables
/// the feature. Ctrl+Shift+G is unlikely to clash with a game.
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+G";

/// A modifier in canonical order/spelling.
const MODIFIERS: &[(&str, &str)] = &[
    ("ctrl", "Ctrl"),
    ("control", "Ctrl"),
    ("shift", "Shift"),
    ("alt", "Alt"),
    ("option", "Alt"),
    ("super", "Super"),
    ("cmd", "Super"),
    ("command", "Super"),
    ("meta", "Super"),
    ("win", "Super"),
];

/// Canonical order modifiers are emitted in.
const MOD_ORDER: &[&str] = &["Ctrl", "Alt", "Shift", "Super"];

fn canon_modifier(tok: &str) -> Option<&'static str> {
    MODIFIERS.iter().find(|(k, _)| *k == tok).map(|(_, v)| *v)
}

/// Canonicalise a key token (single letter/digit or a named key). Returns the
/// display spelling, or `None` if it isn't a recognised key.
fn canon_key(tok: &str) -> Option<String> {
    // Single alphanumeric: upper-case it (g -> G, 4 -> 4).
    if tok.len() == 1 {
        let c = tok.chars().next().unwrap();
        if c.is_ascii_alphanumeric() {
            return Some(c.to_ascii_uppercase().to_string());
        }
    }
    // Function keys F1..F24.
    if let Some(num) = tok.strip_prefix('f') {
        if let Ok(n) = num.parse::<u8>() {
            if (1..=24).contains(&n) {
                return Some(format!("F{n}"));
            }
        }
    }
    // A few named keys we accept by name.
    let named = match tok {
        "space" => "Space",
        "enter" | "return" => "Enter",
        "tab" => "Tab",
        "home" => "Home",
        "end" => "End",
        "insert" => "Insert",
        "delete" | "del" => "Delete",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "up" => "Up",
        "down" => "Down",
        "left" => "Left",
        "right" => "Right",
        _ => return None,
    };
    Some(named.to_string())
}

/// Parse and canonicalise `input` into "Mod+Mod+Key" form. Returns an error
/// string (suitable for surfacing to the user) when there's no key, only
/// modifiers, or an unrecognised token.
pub fn canonicalize(input: &str) -> Result<String, String> {
    let mut mods: Vec<&'static str> = Vec::new();
    let mut key: Option<String> = None;

    for raw in input.split('+') {
        let tok = raw.trim().to_ascii_lowercase();
        if tok.is_empty() {
            continue;
        }
        if let Some(m) = canon_modifier(&tok) {
            if !mods.contains(&m) {
                mods.push(m);
            }
        } else if let Some(k) = canon_key(&tok) {
            if key.is_some() {
                return Err("only one non-modifier key is allowed".into());
            }
            key = Some(k);
        } else {
            return Err(format!("unrecognised key: '{}'", raw.trim()));
        }
    }

    let key = key.ok_or_else(|| "a non-modifier key is required".to_string())?;
    // Emit modifiers in canonical order.
    let mut ordered: Vec<&str> = MOD_ORDER
        .iter()
        .copied()
        .filter(|m| mods.contains(m))
        .collect();
    ordered.push(&key);
    Ok(ordered.join("+"))
}

/// What to do with the window when the hotkey fires, given its current
/// visibility + focus. Pure decision so the glue is trivial.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleAction {
    /// Window is hidden or unfocused → bring it to the front.
    ShowAndFocus,
    /// Window is visible and focused → hide it (summon/dismiss toggle).
    Hide,
}

/// Decide the toggle action. A visible-but-unfocused window is summoned to the
/// front rather than hidden, matching how Steam's Big Picture hotkey behaves.
pub fn toggle_action(visible: bool, focused: bool) -> ToggleAction {
    if visible && focused {
        ToggleAction::Hide
    } else {
        ToggleAction::ShowAndFocus
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_spacing_case_and_order() {
        assert_eq!(canonicalize("ctrl + shift+g").unwrap(), "Ctrl+Shift+G");
        // Order is normalised regardless of input order.
        assert_eq!(canonicalize("shift+alt+ctrl+k").unwrap(), "Ctrl+Alt+Shift+K");
    }

    #[test]
    fn accepts_synonyms_and_named_keys() {
        assert_eq!(canonicalize("control+space").unwrap(), "Ctrl+Space");
        assert_eq!(canonicalize("cmd+f5").unwrap(), "Super+F5");
        assert_eq!(canonicalize("win+up").unwrap(), "Super+Up");
    }

    #[test]
    fn dedupes_repeated_modifiers() {
        assert_eq!(canonicalize("ctrl+control+g").unwrap(), "Ctrl+G");
    }

    #[test]
    fn rejects_modifier_only_and_empty() {
        assert!(canonicalize("ctrl+shift").is_err());
        assert!(canonicalize("   ").is_err());
        assert!(canonicalize("").is_err());
    }

    #[test]
    fn rejects_unknown_and_double_key() {
        assert!(canonicalize("ctrl+frobnicate").is_err());
        assert!(canonicalize("ctrl+g+h").is_err());
    }

    #[test]
    fn rejects_out_of_range_function_key() {
        assert!(canonicalize("f25").is_err());
        assert_eq!(canonicalize("f24").unwrap(), "F24");
    }

    #[test]
    fn toggle_hides_only_when_visible_and_focused() {
        assert_eq!(toggle_action(true, true), ToggleAction::Hide);
        assert_eq!(toggle_action(true, false), ToggleAction::ShowAndFocus);
        assert_eq!(toggle_action(false, false), ToggleAction::ShowAndFocus);
    }

    #[test]
    fn default_shortcut_is_valid() {
        assert_eq!(canonicalize(DEFAULT_SHORTCUT).unwrap(), "Ctrl+Shift+G");
    }
}
