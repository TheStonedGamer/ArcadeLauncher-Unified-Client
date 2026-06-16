//! The per-game download queue state machine. Pure: it models the legal status
//! transitions and overall progress math, with no IO or timers, so the lifecycle
//! is unit-tested independently of the HTTP transport that drives it (T4b).

use serde::{Deserialize, Serialize};

/// Lifecycle of one game's install. Mirrors the phases the C++ client shows in
/// its download-status window (download → verify → extract).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    /// Waiting for a free download slot.
    Queued,
    /// Bytes are transferring.
    Downloading,
    /// All files fetched; checking SHA-256.
    Verifying,
    /// Unpacking a `pc_archive` install.
    Extracting,
    /// Installed and ready to launch.
    Done,
    /// Stopped with an error; can be retried (→ Queued).
    Failed,
    /// User-paused; can be resumed (→ Downloading).
    Paused,
}

impl DownloadStatus {
    /// Whether a transition to `next` is allowed from this status. Keeping the
    /// rules in one place prevents the transport from driving an item into a
    /// nonsensical state (e.g. Done → Downloading).
    pub fn can_transition_to(self, next: DownloadStatus) -> bool {
        use DownloadStatus::*;
        matches!(
            (self, next),
            (Queued, Downloading)
                | (Queued, Paused)
                | (Queued, Failed)
                | (Downloading, Verifying)
                | (Downloading, Paused)
                | (Downloading, Failed)
                | (Paused, Downloading)
                | (Paused, Failed)
                | (Verifying, Extracting)
                | (Verifying, Done)
                | (Verifying, Failed)
                | (Extracting, Done)
                | (Extracting, Failed)
                | (Failed, Queued)
        )
    }

    /// Terminal success — no further transitions and the game is launchable.
    pub fn is_done(self) -> bool {
        matches!(self, DownloadStatus::Done)
    }

    /// Actively occupying a download slot (counts toward the concurrency cap).
    pub fn is_active(self) -> bool {
        matches!(
            self,
            DownloadStatus::Downloading | DownloadStatus::Verifying | DownloadStatus::Extracting
        )
    }
}

/// Progress of one install: bytes transferred toward the manifest total.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub status: DownloadStatus,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

impl Progress {
    pub fn queued(total_bytes: u64) -> Self {
        Progress { status: DownloadStatus::Queued, downloaded_bytes: 0, total_bytes }
    }

    /// Integer percent in `[0, 100]`. Zero total → 0%; clamps overflow.
    pub fn percent(&self) -> u32 {
        if self.total_bytes == 0 {
            return 0;
        }
        let done = self.downloaded_bytes.min(self.total_bytes) as u128;
        ((done * 100) / self.total_bytes as u128) as u32
    }

    /// Attempt a status change, enforcing the transition rules. Returns false
    /// (and leaves the status unchanged) if the transition is illegal.
    pub fn set_status(&mut self, next: DownloadStatus) -> bool {
        if self.status.can_transition_to(next) {
            self.status = next;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use DownloadStatus::*;

    #[test]
    fn happy_path_transitions() {
        let mut p = Progress::queued(1000);
        assert!(p.set_status(Downloading));
        assert!(p.set_status(Verifying));
        assert!(p.set_status(Extracting));
        assert!(p.set_status(Done));
        assert!(p.status.is_done());
    }

    #[test]
    fn pause_resume_and_retry() {
        let mut p = Progress::queued(10);
        assert!(p.set_status(Downloading));
        assert!(p.set_status(Paused));
        assert!(p.set_status(Downloading)); // resume
        assert!(p.set_status(Failed));
        assert!(p.set_status(Queued)); // retry
    }

    #[test]
    fn illegal_transitions_are_rejected() {
        let mut p = Progress::queued(10);
        p.set_status(Downloading);
        p.set_status(Verifying);
        p.set_status(Done);
        // Done is terminal.
        assert!(!p.set_status(Downloading));
        assert_eq!(p.status, Done);
    }

    #[test]
    fn verify_can_skip_extract_for_non_archives() {
        let mut p = Progress::queued(10);
        p.set_status(Downloading);
        p.set_status(Verifying);
        assert!(p.set_status(Done)); // no extraction phase
    }

    #[test]
    fn percent_math() {
        assert_eq!(Progress { status: Downloading, downloaded_bytes: 0, total_bytes: 0 }.percent(), 0);
        assert_eq!(Progress { status: Downloading, downloaded_bytes: 50, total_bytes: 200 }.percent(), 25);
        assert_eq!(Progress { status: Downloading, downloaded_bytes: 200, total_bytes: 200 }.percent(), 100);
        // Over-count clamps to 100, never exceeds.
        assert_eq!(Progress { status: Downloading, downloaded_bytes: 999, total_bytes: 200 }.percent(), 100);
    }

    #[test]
    fn active_and_slot_accounting() {
        assert!(Downloading.is_active());
        assert!(Verifying.is_active());
        assert!(Extracting.is_active());
        assert!(!Queued.is_active());
        assert!(!Paused.is_active());
        assert!(!Done.is_active());
    }
}
