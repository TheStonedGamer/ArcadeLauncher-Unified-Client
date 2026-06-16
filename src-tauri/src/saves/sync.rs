//! Pure cloud-save sync-decision core. Given the set of save files present
//! locally and the set the server reports for the same game, decide — per file
//! — what should happen: upload the local copy, download the remote copy, leave
//! it alone, or flag a conflict for the user.
//!
//! This is the IO-free heart of T8 (cloud saves). It performs **no** disk or
//! network access; the transport glue (list/get/put against the server's
//! `/api/saves/:id` endpoints) sits on top and simply executes the plan this
//! module produces. Keeping the decision logic pure means every branch is
//! exhaustively unit-tested below.
//!
//! ## Server contract mirrored here
//! A save file is identified by a relative `path` and carries an `mtime` (Unix
//! seconds) and a `size` (bytes). The server exposes:
//! - `GET /api/saves/:id`            → `{ files: [{ path, mtime, size }] }`
//! - `GET /api/saves/:id/file?path=` → raw bytes
//! - `PUT /api/saves/:id/file?path=&mtime=` → upsert
//!
//! ## Decision rule (v1 — last-write-wins by mtime)
//! For each path in the union of the two sides:
//! - present only locally  → **Upload**
//! - present only remotely  → **Download**
//! - present on both:
//!   - identical `mtime` **and** `size` → **InSync** (nothing to do)
//!   - newer local `mtime`  → **Upload**
//!   - newer remote `mtime`  → **Download**
//!   - identical `mtime` but **different** `size` → **Conflict** (ambiguous;
//!     surfaced to the user instead of silently clobbering either copy)
//!
//! The plan is returned sorted by path so the output is deterministic and the
//! tests are stable.

use serde::{Deserialize, Serialize};

/// One save file as the server describes it (and as we describe local files,
/// so both sides share a type). `path` is relative, using `/` separators.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFile {
    pub path: String,
    /// Last-modified time in Unix seconds.
    pub mtime: i64,
    /// Size in bytes.
    pub size: u64,
}

impl SaveFile {
    pub fn new(path: impl Into<String>, mtime: i64, size: u64) -> Self {
        SaveFile { path: path.into(), mtime, size }
    }
}

/// What to do with a single save file to bring the two sides into agreement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncAction {
    /// Local copy is authoritative — PUT it to the server.
    Upload,
    /// Remote copy is authoritative — GET it and write it locally.
    Download,
    /// Both sides already agree; do nothing.
    InSync,
    /// Same mtime, different size — can't decide automatically; ask the user.
    Conflict,
}

/// A single line of the sync plan: the file and the decision for it. Carries the
/// `mtime`/`size` the action should use (the authoritative side's, or both for a
/// conflict) so the transport layer doesn't have to re-look-them-up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncItem {
    pub path: String,
    pub action: SyncAction,
    /// The local file, if one exists.
    pub local: Option<SaveFile>,
    /// The remote file, if one exists.
    pub remote: Option<SaveFile>,
}

/// Build a deterministic, sorted sync plan from the local and remote file sets.
///
/// Duplicate paths within a side are tolerated: the **last** occurrence wins
/// (matching how a map would overwrite), so callers don't have to pre-dedupe.
pub fn plan_sync(local: &[SaveFile], remote: &[SaveFile]) -> Vec<SyncItem> {
    use std::collections::BTreeMap;

    // Index each side by path (last write wins on duplicates), and collect the
    // union of paths in sorted order for a stable plan.
    let mut local_by: BTreeMap<&str, &SaveFile> = BTreeMap::new();
    for f in local {
        local_by.insert(f.path.as_str(), f);
    }
    let mut remote_by: BTreeMap<&str, &SaveFile> = BTreeMap::new();
    for f in remote {
        remote_by.insert(f.path.as_str(), f);
    }

    let mut paths: Vec<&str> = local_by.keys().copied().chain(remote_by.keys().copied()).collect();
    paths.sort_unstable();
    paths.dedup();

    paths
        .into_iter()
        .map(|path| {
            let l = local_by.get(path).copied();
            let r = remote_by.get(path).copied();
            let action = decide(l, r);
            SyncItem {
                path: path.to_string(),
                action,
                local: l.cloned(),
                remote: r.cloned(),
            }
        })
        .collect()
}

/// The per-file decision rule (see module docs). Exposed for direct testing.
fn decide(local: Option<&SaveFile>, remote: Option<&SaveFile>) -> SyncAction {
    match (local, remote) {
        (Some(_), None) => SyncAction::Upload,
        (None, Some(_)) => SyncAction::Download,
        (Some(l), Some(r)) => {
            if l.mtime == r.mtime {
                if l.size == r.size {
                    SyncAction::InSync
                } else {
                    SyncAction::Conflict
                }
            } else if l.mtime > r.mtime {
                SyncAction::Upload
            } else {
                SyncAction::Download
            }
        }
        // `plan_sync` never produces this (a path is in the union only if at
        // least one side has it), but the rule is total for safety.
        (None, None) => SyncAction::InSync,
    }
}

/// Counts of each action in a plan, for a quick "12 to upload, 3 to download,
/// 1 conflict" summary in the UI without re-scanning the plan elsewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub upload: usize,
    pub download: usize,
    pub in_sync: usize,
    pub conflict: usize,
}

impl SyncSummary {
    /// Tally a plan. `total` work to do = `upload + download` (+ `conflict`,
    /// which needs a decision first).
    pub fn of(plan: &[SyncItem]) -> Self {
        let mut s = SyncSummary::default();
        for item in plan {
            match item.action {
                SyncAction::Upload => s.upload += 1,
                SyncAction::Download => s.download += 1,
                SyncAction::InSync => s.in_sync += 1,
                SyncAction::Conflict => s.conflict += 1,
            }
        }
        s
    }

    /// Whether any file needs transferring or resolving (i.e. not fully in sync).
    pub fn has_work(&self) -> bool {
        self.upload > 0 || self.download > 0 || self.conflict > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, mtime: i64, size: u64) -> SaveFile {
        SaveFile::new(path, mtime, size)
    }

    fn actions(plan: &[SyncItem]) -> Vec<(&str, SyncAction)> {
        plan.iter().map(|i| (i.path.as_str(), i.action)).collect()
    }

    #[test]
    fn local_only_uploads() {
        let plan = plan_sync(&[f("a.sav", 10, 100)], &[]);
        assert_eq!(actions(&plan), vec![("a.sav", SyncAction::Upload)]);
        // The item carries the local side and no remote.
        assert_eq!(plan[0].local, Some(f("a.sav", 10, 100)));
        assert_eq!(plan[0].remote, None);
    }

    #[test]
    fn remote_only_downloads() {
        let plan = plan_sync(&[], &[f("b.sav", 10, 100)]);
        assert_eq!(actions(&plan), vec![("b.sav", SyncAction::Download)]);
        assert_eq!(plan[0].local, None);
        assert_eq!(plan[0].remote, Some(f("b.sav", 10, 100)));
    }

    #[test]
    fn identical_mtime_and_size_is_in_sync() {
        let plan = plan_sync(&[f("c.sav", 42, 256)], &[f("c.sav", 42, 256)]);
        assert_eq!(actions(&plan), vec![("c.sav", SyncAction::InSync)]);
    }

    #[test]
    fn newer_local_uploads() {
        let plan = plan_sync(&[f("d.sav", 200, 10)], &[f("d.sav", 100, 10)]);
        assert_eq!(actions(&plan), vec![("d.sav", SyncAction::Upload)]);
    }

    #[test]
    fn newer_remote_downloads() {
        let plan = plan_sync(&[f("e.sav", 100, 10)], &[f("e.sav", 200, 10)]);
        assert_eq!(actions(&plan), vec![("e.sav", SyncAction::Download)]);
    }

    #[test]
    fn same_mtime_different_size_conflicts() {
        let plan = plan_sync(&[f("g.sav", 50, 10)], &[f("g.sav", 50, 20)]);
        assert_eq!(actions(&plan), vec![("g.sav", SyncAction::Conflict)]);
        // Both sides are retained so the UI can show "local 10 B vs remote 20 B".
        assert_eq!(plan[0].local.as_ref().unwrap().size, 10);
        assert_eq!(plan[0].remote.as_ref().unwrap().size, 20);
    }

    #[test]
    fn newer_mtime_wins_even_when_smaller() {
        // mtime is authoritative; a newer-but-smaller local copy still uploads.
        let plan = plan_sync(&[f("h.sav", 300, 5)], &[f("h.sav", 100, 9999)]);
        assert_eq!(actions(&plan), vec![("h.sav", SyncAction::Upload)]);
    }

    #[test]
    fn plan_is_sorted_by_path_and_covers_the_union() {
        let local = vec![f("z.sav", 1, 1), f("m.sav", 5, 1)];
        let remote = vec![f("a.sav", 1, 1), f("m.sav", 9, 1)];
        let plan = plan_sync(&local, &remote);
        assert_eq!(
            actions(&plan),
            vec![
                ("a.sav", SyncAction::Download), // remote only
                ("m.sav", SyncAction::Download), // remote newer
                ("z.sav", SyncAction::Upload),   // local only
            ]
        );
    }

    #[test]
    fn duplicate_path_last_occurrence_wins() {
        // Two local entries for the same path: the later (newer) one decides.
        let local = vec![f("dup.sav", 10, 1), f("dup.sav", 100, 1)];
        let remote = vec![f("dup.sav", 50, 1)];
        let plan = plan_sync(&local, &remote);
        assert_eq!(actions(&plan), vec![("dup.sav", SyncAction::Upload)]);
    }

    #[test]
    fn empty_both_sides_is_empty_plan() {
        let plan = plan_sync(&[], &[]);
        assert!(plan.is_empty());
        let s = SyncSummary::of(&plan);
        assert!(!s.has_work());
    }

    #[test]
    fn summary_tallies_each_action() {
        let local = vec![f("up.sav", 9, 1), f("eq.sav", 5, 1), f("cf.sav", 7, 1)];
        let remote = vec![
            f("down.sav", 1, 1),
            f("eq.sav", 5, 1),
            f("cf.sav", 7, 2), // same mtime, different size → conflict
        ];
        let plan = plan_sync(&local, &remote);
        let s = SyncSummary::of(&plan);
        assert_eq!(
            s,
            SyncSummary { upload: 1, download: 1, in_sync: 1, conflict: 1 }
        );
        assert!(s.has_work());
    }
}
