//! Reconnect backoff schedule for the live social gateway. Pure and
//! deterministic: the async connect loop owns the timer and the socket, this
//! owns only the *policy* — how long to wait before the Nth retry — so the
//! schedule can be unit-tested without sleeping or networking.
//!
//! Exponential backoff with a cap and full jitter (jitter applied by the
//! caller against [`Backoff::base_delay_ms`]); on a successful connection the
//! caller calls [`Backoff::reset`] so the next disconnect starts from the floor.

/// Exponential-backoff policy. Delays double from `floor_ms` up to `cap_ms`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backoff {
    floor_ms: u64,
    cap_ms: u64,
    attempt: u32,
}

impl Backoff {
    /// Standard schedule: 1s floor, 30s cap. Matches the C++ client's reconnect feel.
    pub fn standard() -> Self {
        Backoff::new(1_000, 30_000)
    }

    pub fn new(floor_ms: u64, cap_ms: u64) -> Self {
        debug_assert!(floor_ms > 0 && cap_ms >= floor_ms);
        Backoff { floor_ms, cap_ms, attempt: 0 }
    }

    /// The base delay (before jitter) for the current attempt, then advance the
    /// counter. `floor * 2^attempt`, saturating at `cap`. The caller applies
    /// jitter in `[0, base]` to avoid thundering-herd reconnects.
    pub fn next_base_delay_ms(&mut self) -> u64 {
        let delay = self.base_delay_ms();
        self.attempt = self.attempt.saturating_add(1);
        delay
    }

    /// The base delay for the current attempt without advancing.
    pub fn base_delay_ms(&self) -> u64 {
        let factor = 1u64.checked_shl(self.attempt).unwrap_or(u64::MAX);
        self.floor_ms.saturating_mul(factor).min(self.cap_ms)
    }

    /// Call after a connection succeeds: the next disconnect retries from the floor.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn attempt(&self) -> u32 {
        self.attempt
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_from_floor_to_cap() {
        let mut b = Backoff::new(1_000, 30_000);
        assert_eq!(b.next_base_delay_ms(), 1_000);
        assert_eq!(b.next_base_delay_ms(), 2_000);
        assert_eq!(b.next_base_delay_ms(), 4_000);
        assert_eq!(b.next_base_delay_ms(), 8_000);
        assert_eq!(b.next_base_delay_ms(), 16_000);
        // 32_000 would exceed the cap → clamped.
        assert_eq!(b.next_base_delay_ms(), 30_000);
        assert_eq!(b.next_base_delay_ms(), 30_000);
    }

    #[test]
    fn reset_returns_to_floor() {
        let mut b = Backoff::standard();
        b.next_base_delay_ms();
        b.next_base_delay_ms();
        assert!(b.attempt() > 0);
        b.reset();
        assert_eq!(b.attempt(), 0);
        assert_eq!(b.base_delay_ms(), 1_000);
    }

    #[test]
    fn never_overflows_after_many_attempts() {
        let mut b = Backoff::new(1_000, 30_000);
        // Far past the point where 2^attempt overflows u64 — must stay at cap.
        for _ in 0..200 {
            b.next_base_delay_ms();
        }
        assert_eq!(b.base_delay_ms(), 30_000);
    }

    #[test]
    fn base_delay_does_not_advance() {
        let b = Backoff::standard();
        assert_eq!(b.base_delay_ms(), 1_000);
        assert_eq!(b.base_delay_ms(), 1_000);
        assert_eq!(b.attempt(), 0);
    }
}
