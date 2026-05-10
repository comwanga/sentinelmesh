use std::time::Duration;

/// Exponential backoff policy matching the TypeScript worker:
/// delay = 2^attempt minutes, capped at max_delay.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub max_delay: Duration,
}

impl RetryPolicy {
    /// Default policy matching the TypeScript MAX_RETRIES=5 and backoff.
    pub fn default_publish() -> Self {
        Self {
            max_attempts: 5,
            max_delay: Duration::from_secs(60 * 32), // cap above the max natural delay at attempt 4 (2^4 = 16 min)
        }
    }

    /// Returns the backoff duration for a given attempt count (0-indexed).
    /// Matches TypeScript: `Math.pow(2, currentRetryCount)` minutes.
    pub fn delay_for(&self, attempt: u32) -> Duration {
        let minutes = 2u64.saturating_pow(attempt);
        let raw = Duration::from_secs(minutes.saturating_mul(60));
        raw.min(self.max_delay)
    }

    pub fn is_exhausted(&self, retry_count: i32) -> bool {
        retry_count >= self.max_attempts as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_matches_typescript() {
        let p = RetryPolicy::default_publish();
        assert_eq!(p.delay_for(0), Duration::from_secs(60));   // 2^0 = 1 min
        assert_eq!(p.delay_for(1), Duration::from_secs(120));  // 2^1 = 2 min
        assert_eq!(p.delay_for(2), Duration::from_secs(240));  // 2^2 = 4 min
        assert_eq!(p.delay_for(3), Duration::from_secs(480));  // 2^3 = 8 min
        assert_eq!(p.delay_for(4), Duration::from_secs(960));  // 2^4 = 16 min
    }

    #[test]
    fn backoff_caps_at_max_delay() {
        let p = RetryPolicy::default_publish();
        // 2^10 would be 1024 min, must be capped at 32 min
        assert_eq!(p.delay_for(10), p.max_delay);
    }

    #[test]
    fn exhaustion_check() {
        let p = RetryPolicy::default_publish();
        assert!(!p.is_exhausted(4));
        assert!(p.is_exhausted(5));
        assert!(p.is_exhausted(99));
    }
}
