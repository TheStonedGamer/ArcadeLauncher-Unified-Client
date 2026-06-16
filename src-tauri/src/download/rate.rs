//! Bandwidth-throttle math. The download transport caps throughput at the user's
//! configured KB/s limit by sleeping between received chunks. The decision of
//! *how long* to sleep is pure arithmetic — given how many bytes have been
//! transferred and how much wall time has elapsed, return the millisecond delay
//! needed to keep the average rate at or under the cap — so it is unit-tested
//! without any real timers. A cap of 0 means unlimited (no throttling).

/// Tracks bytes transferred against a target rate to derive throttle delays.
pub struct Throttle {
    /// Cap in bytes per second; 0 means unlimited.
    cap_bps: u64,
    /// Bytes counted so far in this throttle window.
    sent: u64,
}

impl Throttle {
    /// Build from a KB/s cap (as stored in settings). 0 KB/s = unlimited.
    pub fn new(cap_kbps: u64) -> Self {
        Throttle { cap_bps: cap_kbps.saturating_mul(1024), sent: 0 }
    }

    /// An explicitly unlimited throttle (never sleeps).
    pub fn unlimited() -> Self {
        Throttle { cap_bps: 0, sent: 0 }
    }

    /// Whether a cap is in effect. When false the transport skips the clock
    /// bookkeeping entirely.
    pub fn is_limited(&self) -> bool {
        self.cap_bps > 0
    }

    /// Account for `bytes` just received.
    pub fn record(&mut self, bytes: u64) {
        self.sent = self.sent.saturating_add(bytes);
    }

    /// Given the wall time elapsed since this window started, the milliseconds to
    /// sleep so the average rate does not exceed the cap. Returns 0 when
    /// unlimited or already at/under the target pace.
    pub fn delay_ms(&self, elapsed_ms: u64) -> u64 {
        if self.cap_bps == 0 {
            return 0;
        }
        // Time the transfer *should* have taken at the cap, in ms.
        let required_ms = self.sent.saturating_mul(1000) / self.cap_bps;
        required_ms.saturating_sub(elapsed_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlimited_never_delays() {
        let mut t = Throttle::new(0);
        assert!(!t.is_limited());
        t.record(10_000_000);
        assert_eq!(t.delay_ms(0), 0);
    }

    #[test]
    fn delays_when_ahead_of_pace() {
        // Cap 100 KB/s = 102400 B/s. After 102400 bytes the budget is 1000ms.
        let mut t = Throttle::new(100);
        assert!(t.is_limited());
        t.record(102_400);
        // No time elapsed yet → must wait the full 1000ms.
        assert_eq!(t.delay_ms(0), 1000);
        // Half the budget already spent → wait the remaining 500ms.
        assert_eq!(t.delay_ms(500), 500);
    }

    #[test]
    fn no_delay_when_behind_pace() {
        let mut t = Throttle::new(100);
        t.record(102_400); // 1000ms budget
        // Already spent more wall time than budget → no sleep.
        assert_eq!(t.delay_ms(1500), 0);
        assert_eq!(t.delay_ms(1000), 0);
    }

    #[test]
    fn delay_scales_with_bytes() {
        let mut t = Throttle::new(100); // 102400 B/s
        t.record(204_800); // two seconds' worth
        assert_eq!(t.delay_ms(0), 2000);
    }
}
