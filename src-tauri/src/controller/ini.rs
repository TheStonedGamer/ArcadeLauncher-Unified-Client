//! Minimal, non-destructive INI editor used to write emulator pad configs.
//!
//! Emulator config files (PCSX2.ini, DuckStation settings.ini) hold dozens of
//! sections we must not touch. We only ever *set* a handful of keys inside one
//! named section: existing keys are replaced in place, new keys appended to the
//! end of that section, and every other line — other sections, comments, blank
//! lines, unrelated keys — is preserved byte-for-byte. The section is created
//! at the end of the file if it doesn't exist yet.
//!
//! This is deliberately not a general INI library: it preserves layout rather
//! than normalizing it, which is what keeps the write safe on a real config.

/// Set `kvs` (key → value) inside `[section]` of `text`, preserving everything
/// else. Keys already present in the section are replaced; missing keys are
/// appended; a missing section is created at the end. Values are written as
/// `Key = Value` to match the emulators' own formatting.
pub fn set_keys(text: &str, section: &str, kvs: &[(String, String)]) -> String {
    // Use the file's existing newline style; default to LF for a new file.
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let header = format!("[{section}]");

    // Split into lines, dropping a single trailing empty element from a final
    // newline so we can re-join cleanly.
    let mut lines: Vec<String> = text.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
    if lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }

    // Locate the target section's header and the index where its body ends
    // (the line before the next `[...]` header, or end of file).
    let mut sec_start: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        if line.trim() == header {
            sec_start = Some(i);
            break;
        }
    }

    let mut remaining: Vec<(String, String)> = kvs.to_vec();

    match sec_start {
        Some(start) => {
            // End of this section's body = next header or EOF.
            let mut end = lines.len();
            for i in (start + 1)..lines.len() {
                if is_header(&lines[i]) {
                    end = i;
                    break;
                }
            }
            // Replace existing keys in place.
            for line in lines.iter_mut().take(end).skip(start + 1) {
                if let Some(key) = key_of(line) {
                    if let Some(pos) = remaining.iter().position(|(k, _)| k == &key) {
                        let (k, v) = remaining.remove(pos);
                        *line = format!("{k} = {v}");
                    }
                }
            }
            // Append any keys not already present, at the end of the body.
            let insert_at = trim_back_blanks(&lines, start + 1, end);
            let new_lines: Vec<String> =
                remaining.iter().map(|(k, v)| format!("{k} = {v}")).collect();
            splice(&mut lines, insert_at, new_lines);
        }
        None => {
            // Create the section at EOF, separated by a blank line if needed.
            if !lines.is_empty() && !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
                lines.push(String::new());
            }
            lines.push(header);
            for (k, v) in &remaining {
                lines.push(format!("{k} = {v}"));
            }
        }
    }

    let mut out = lines.join(nl);
    out.push_str(nl);
    out
}

/// True for a `[section]` header line.
fn is_header(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('[') && t.ends_with(']')
}

/// The key of a `Key = Value` line (trimmed), or None for comments/blanks.
fn key_of(line: &str) -> Option<String> {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') || t.starts_with(';') || t.starts_with('[') {
        return None;
    }
    let eq = t.find('=')?;
    Some(t[..eq].trim().to_string())
}

/// Index at which to insert appended keys: just after the last non-blank body
/// line, so new keys group with the section rather than after trailing blanks.
fn trim_back_blanks(lines: &[String], start: usize, end: usize) -> usize {
    let mut at = end;
    while at > start && lines[at - 1].trim().is_empty() {
        at -= 1;
    }
    at
}

fn splice(lines: &mut Vec<String>, at: usize, new_lines: Vec<String>) {
    let tail = lines.split_off(at);
    lines.extend(new_lines);
    lines.extend(tail);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_key_in_section() {
        let text = "[Pad1]\nType = Keyboard\nCross = Keyboard/X\n";
        let out = set_keys(text, "Pad1", &[("Cross".into(), "SDL-0/FaceSouth".into())]);
        assert!(out.contains("Cross = SDL-0/FaceSouth"));
        assert!(!out.contains("Keyboard/X"));
        // Untouched key preserved.
        assert!(out.contains("Type = Keyboard"));
    }

    #[test]
    fn appends_missing_key_within_section() {
        let text = "[Pad1]\nType = DualShock2\n\n[Hotkeys]\nFoo = Bar\n";
        let out = set_keys(text, "Pad1", &[("Cross".into(), "SDL-0/FaceSouth".into())]);
        // New key lands in [Pad1], not [Hotkeys].
        let pad_idx = out.find("[Pad1]").unwrap();
        let hot_idx = out.find("[Hotkeys]").unwrap();
        let cross_idx = out.find("Cross =").unwrap();
        assert!(cross_idx > pad_idx && cross_idx < hot_idx);
        // Other section untouched.
        assert!(out.contains("Foo = Bar"));
    }

    #[test]
    fn creates_missing_section_at_eof() {
        let text = "[InputSources]\nSDL = true\n";
        let out = set_keys(text, "Pad1", &[("Type".into(), "DualShock2".into())]);
        assert!(out.contains("[InputSources]"));
        assert!(out.contains("[Pad1]"));
        assert!(out.contains("Type = DualShock2"));
    }

    #[test]
    fn creates_section_in_empty_file() {
        let out = set_keys("", "InputSources", &[("SDL".into(), "true".into())]);
        assert_eq!(out, "[InputSources]\nSDL = true\n");
    }

    #[test]
    fn preserves_crlf_style() {
        let text = "[Pad1]\r\nType = Keyboard\r\n";
        let out = set_keys(text, "Pad1", &[("Type".into(), "DualShock2".into())]);
        assert!(out.contains("\r\n"));
        assert!(out.contains("Type = DualShock2"));
    }

    #[test]
    fn only_touches_named_section_not_lookalike_keys() {
        // A key named like ours in a different section must not be replaced.
        let text = "[Pad2]\nCross = Keyboard/Z\n\n[Pad1]\nCross = Keyboard/X\n";
        let out = set_keys(text, "Pad1", &[("Cross".into(), "SDL-0/FaceSouth".into())]);
        assert!(out.contains("Cross = Keyboard/Z")); // Pad2 untouched
        assert!(out.contains("Cross = SDL-0/FaceSouth")); // Pad1 updated
    }
}
