//! Pure save **version-history** core. To retire the last-write-wins conflict
//! problem (T12i), every sync/exit snapshot of a game's save folder is recorded
//! as a `SaveVersion`, and we keep the newest N restorable ones — older
//! snapshots are pruned. All of the decision logic (ordering, retention, id
//! formatting/parsing) is IO-free and unit-tested here; the thin glue in
//! `commands` copies bytes into / out of the version directories the plan names.

use serde::{Deserialize, Serialize};

/// Metadata for one stored snapshot of a game's save folder. `id` is the
/// snapshot's directory name; `created_at` is a Unix timestamp (seconds).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersion {
    pub id: String,
    pub created_at: i64,
    pub file_count: usize,
    pub total_bytes: u64,
}

/// The default number of restorable versions kept per game.
pub const DEFAULT_KEEP: usize = 10;

/// Clamp a requested retention count into a sane range: always keep at least 1
/// (a snapshot you immediately prune is pointless) and never more than 100.
pub fn clamp_keep(keep: usize) -> usize {
    keep.clamp(1, 100)
}

/// Format a snapshot id from its creation time and a within-second sequence.
/// Sortable as a plain string because the timestamp is zero-padded to 20 digits
/// (covers i64) and the sequence to 4 digits: `v{ts:020}-{seq:04}`.
pub fn format_version_id(created_at: i64, seq: u32) -> String {
    format!("v{:020}-{:04}", created_at.max(0), seq.min(9999))
}

/// Parse a snapshot id's creation time back out, if it is one we produced.
pub fn parse_version_time(id: &str) -> Option<i64> {
    let rest = id.strip_prefix('v')?;
    let (ts, _seq) = rest.split_once('-')?;
    ts.parse::<i64>().ok()
}

/// Pick a fresh snapshot id for `created_at` that does not collide with any
/// existing id in `existing` (bumping the within-second sequence as needed).
pub fn next_version_id(created_at: i64, existing: &[SaveVersion]) -> String {
    for seq in 0..=9999u32 {
        let id = format_version_id(created_at, seq);
        if !existing.iter().any(|v| v.id == id) {
            return id;
        }
    }
    // Astronomically unlikely (10k snapshots in one second); fall back to the
    // last sequence rather than loop forever.
    format_version_id(created_at, 9999)
}

/// What a retention pass should keep and prune. Both lists hold snapshot ids.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPlan {
    /// Newest-first ids to keep.
    pub keep: Vec<String>,
    /// Ids to delete (the overflow beyond `keep`).
    pub prune: Vec<String>,
}

/// Decide which versions to keep vs prune: keep the newest `keep` snapshots
/// (ties on `created_at` broken by id, descending — ids are time-then-seq, so
/// this is a stable total order), prune the rest. `keep` is clamped to [1,100].
pub fn plan_retention(versions: &[SaveVersion], keep: usize) -> RetentionPlan {
    let keep = clamp_keep(keep);
    let mut ordered: Vec<&SaveVersion> = versions.iter().collect();
    // Newest first: higher created_at first; tie-break on id descending.
    ordered.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    let mut plan = RetentionPlan::default();
    for (i, v) in ordered.into_iter().enumerate() {
        if i < keep {
            plan.keep.push(v.id.clone());
        } else {
            plan.prune.push(v.id.clone());
        }
    }
    plan
}

/// Return the newest snapshot, if any (same ordering as `plan_retention`).
pub fn latest_version(versions: &[SaveVersion]) -> Option<&SaveVersion> {
    versions.iter().max_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(id: &str, created_at: i64) -> SaveVersion {
        SaveVersion { id: id.to_string(), created_at, file_count: 1, total_bytes: 1 }
    }

    #[test]
    fn clamp_keep_bounds() {
        assert_eq!(clamp_keep(0), 1);
        assert_eq!(clamp_keep(1), 1);
        assert_eq!(clamp_keep(10), 10);
        assert_eq!(clamp_keep(100), 100);
        assert_eq!(clamp_keep(9999), 100);
    }

    #[test]
    fn version_id_is_sortable_and_roundtrips() {
        let a = format_version_id(1000, 0);
        let b = format_version_id(2000, 0);
        let c = format_version_id(2000, 1);
        assert!(a < b, "{a} < {b}");
        assert!(b < c, "{b} < {c}");
        assert_eq!(parse_version_time(&a), Some(1000));
        assert_eq!(parse_version_time(&c), Some(2000));
    }

    #[test]
    fn parse_rejects_foreign_ids() {
        assert_eq!(parse_version_time("nope"), None);
        assert_eq!(parse_version_time("v123"), None); // no seq separator
        assert_eq!(parse_version_time("vxx-0001"), None);
    }

    #[test]
    fn negative_time_clamped_to_zero_in_id() {
        let id = format_version_id(-5, 0);
        assert_eq!(parse_version_time(&id), Some(0));
    }

    #[test]
    fn next_id_avoids_collision() {
        let existing = vec![v(&format_version_id(500, 0), 500), v(&format_version_id(500, 1), 500)];
        assert_eq!(next_version_id(500, &existing), format_version_id(500, 2));
    }

    #[test]
    fn next_id_first_when_empty() {
        assert_eq!(next_version_id(42, &[]), format_version_id(42, 0));
    }

    #[test]
    fn retention_keeps_newest_n() {
        let versions = vec![v("a", 100), v("b", 300), v("c", 200), v("d", 400)];
        let plan = plan_retention(&versions, 2);
        assert_eq!(plan.keep, vec!["d", "b"]);
        let mut pruned = plan.prune.clone();
        pruned.sort();
        assert_eq!(pruned, vec!["a", "c"]);
    }

    #[test]
    fn retention_keep_all_when_under_limit() {
        let versions = vec![v("a", 100), v("b", 200)];
        let plan = plan_retention(&versions, 10);
        assert_eq!(plan.keep.len(), 2);
        assert!(plan.prune.is_empty());
    }

    #[test]
    fn retention_empty_is_empty() {
        let plan = plan_retention(&[], 5);
        assert!(plan.keep.is_empty());
        assert!(plan.prune.is_empty());
    }

    #[test]
    fn retention_keep_zero_clamped_to_one() {
        let versions = vec![v("a", 100), v("b", 200)];
        let plan = plan_retention(&versions, 0);
        assert_eq!(plan.keep, vec!["b"]);
        assert_eq!(plan.prune, vec!["a"]);
    }

    #[test]
    fn retention_breaks_ties_by_id_desc() {
        // Same timestamp; higher seq id is newer and kept.
        let lo = format_version_id(100, 0);
        let hi = format_version_id(100, 1);
        let versions = vec![v(&lo, 100), v(&hi, 100)];
        let plan = plan_retention(&versions, 1);
        assert_eq!(plan.keep, vec![hi.clone()]);
        assert_eq!(plan.prune, vec![lo]);
    }

    #[test]
    fn latest_picks_newest() {
        let versions = vec![v("a", 100), v("b", 300), v("c", 200)];
        assert_eq!(latest_version(&versions).unwrap().id, "b");
        assert!(latest_version(&[]).is_none());
    }
}
