//! Per-session play history (ROADMAP T12j groundwork). Until now the client only
//! kept *cumulative* `playtimeSeconds` plus a single `lastPlayed` stamp, which
//! can't answer "what did I play this week". This module appends one record per
//! completed play session to a client-local `play_sessions.json`, alongside
//! `catalog_prefs.json` — `library.json` is still never rewritten.
//!
//! The append/prune policy is pure and unit-tested here; the disk store mirrors
//! `prefs.rs` (atomic temp-file + rename, missing file = empty).

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One completed play session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySession {
    /// Catalog game id.
    pub id: String,
    /// Title captured at launch time, so history survives a game leaving the
    /// library (a rename shows the name it had when it was played).
    pub title: String,
    /// Unix seconds when the session started.
    pub started_at: i64,
    /// Wall-clock duration of the session.
    pub seconds: u64,
}

/// The whole log, newest last. Wrapped in a struct so the file can grow new
/// top-level fields later without breaking older readers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionLog {
    pub sessions: Vec<PlaySession>,
}

/// Hard cap on retained records. Well above a year of heavy play, and bounds the
/// file so a runaway launch loop can't grow it without limit.
pub const MAX_SESSIONS: usize = 5000;

/// Records older than this are dropped on write — a recap only ever looks back
/// over a year, and unbounded history isn't worth the disk.
pub const RETAIN_DAYS: i64 = 400;

const DAY: i64 = 86_400;

/// Append a session and apply retention. Pure: `now` (unix seconds) is injected.
///
/// Zero-second sessions are dropped — a game that failed to start or exited
/// instantly is noise in a recap, not history.
pub fn append(log: &SessionLog, session: PlaySession, now: i64) -> SessionLog {
    if session.seconds == 0 {
        return log.clone();
    }
    let mut sessions = log.sessions.clone();
    sessions.push(session);
    prune(sessions, now)
}

/// Drop records older than `RETAIN_DAYS` and keep only the newest `MAX_SESSIONS`.
fn prune(mut sessions: Vec<PlaySession>, now: i64) -> SessionLog {
    let cutoff = now - RETAIN_DAYS * DAY;
    // A record stamped in the future (clock skew) is kept: dropping it would
    // silently lose a session the user just played.
    sessions.retain(|s| s.started_at >= cutoff);
    if sessions.len() > MAX_SESSIONS {
        sessions.drain(..sessions.len() - MAX_SESSIONS);
    }
    SessionLog { sessions }
}

/// Load the log from `path`. Missing/empty file → empty log (first run is not an
/// error). A corrupt file is also treated as empty: play history is derived data,
/// and refusing to launch games over it would be far worse than losing it.
pub fn load(path: &Path) -> AppResult<SessionLog> {
    if !path.exists() {
        return Ok(SessionLog::default());
    }
    let text = std::fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(SessionLog::default());
    }
    Ok(serde_json::from_str::<SessionLog>(&text).unwrap_or_default())
}

/// Save the log to `path` atomically, creating the parent directory if needed.
pub fn save(path: &Path, log: &SessionLog) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string(log)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Record one session: load, append, save. Best-effort by design — the caller
/// (the post-exit thread) must not fail a launch because history couldn't be
/// written.
pub fn record(path: &Path, session: PlaySession, now: i64) -> AppResult<()> {
    let log = load(path)?;
    save(path, &append(&log, session, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, started_at: i64, seconds: u64) -> PlaySession {
        PlaySession { id: id.into(), title: id.to_uppercase(), started_at, seconds }
    }

    const NOW: i64 = 1_700_000_000;

    #[test]
    fn appends_in_order() {
        let log = append(&SessionLog::default(), s("a", NOW - 100, 60), NOW);
        let log = append(&log, s("b", NOW - 50, 30), NOW);
        assert_eq!(log.sessions.len(), 2);
        assert_eq!(log.sessions[0].id, "a");
        assert_eq!(log.sessions[1].id, "b");
    }

    #[test]
    fn drops_zero_second_sessions() {
        let log = append(&SessionLog::default(), s("crash", NOW, 0), NOW);
        assert!(log.sessions.is_empty());
    }

    #[test]
    fn keeps_one_second_sessions() {
        let log = append(&SessionLog::default(), s("blip", NOW, 1), NOW);
        assert_eq!(log.sessions.len(), 1);
    }

    #[test]
    fn prunes_records_past_the_retention_window() {
        let old = s("old", NOW - (RETAIN_DAYS + 1) * DAY, 3600);
        let edge = s("edge", NOW - RETAIN_DAYS * DAY, 3600);
        let log = SessionLog { sessions: vec![old, edge] };
        let out = append(&log, s("new", NOW, 60), NOW);
        let ids: Vec<&str> = out.sessions.iter().map(|x| x.id.as_str()).collect();
        assert_eq!(ids, vec!["edge", "new"]);
    }

    #[test]
    fn keeps_future_stamped_records() {
        let log = append(&SessionLog::default(), s("skewed", NOW + 10 * DAY, 60), NOW);
        assert_eq!(log.sessions.len(), 1);
    }

    #[test]
    fn caps_at_max_sessions_dropping_the_oldest() {
        let sessions: Vec<PlaySession> =
            (0..MAX_SESSIONS).map(|i| s(&format!("g{i}"), NOW - 1000 + i as i64, 60)).collect();
        let log = append(&SessionLog { sessions }, s("newest", NOW, 60), NOW);
        assert_eq!(log.sessions.len(), MAX_SESSIONS);
        assert_eq!(log.sessions[0].id, "g1"); // g0 fell off the front
        assert_eq!(log.sessions[MAX_SESSIONS - 1].id, "newest");
    }

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ualc_sessions_test_{}_{}.json", std::process::id(), name));
        p
    }

    #[test]
    fn missing_file_is_empty() {
        let p = tmp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert_eq!(load(&p).unwrap(), SessionLog::default());
    }

    #[test]
    fn round_trips_through_disk() {
        let p = tmp_path("roundtrip");
        let log = SessionLog { sessions: vec![s("zelda", NOW - 7200, 3600)] };
        save(&p, &log).unwrap();
        assert_eq!(load(&p).unwrap(), log);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupt_file_reads_as_empty_rather_than_failing() {
        let p = tmp_path("corrupt");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load(&p).unwrap(), SessionLog::default());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn record_accumulates_across_calls() {
        let p = tmp_path("record");
        let _ = std::fs::remove_file(&p);
        record(&p, s("a", NOW - 100, 60), NOW).unwrap();
        record(&p, s("b", NOW - 50, 120), NOW).unwrap();
        let log = load(&p).unwrap();
        assert_eq!(log.sessions.len(), 2);
        assert_eq!(log.sessions[1].seconds, 120);
        let _ = std::fs::remove_file(&p);
    }
}
