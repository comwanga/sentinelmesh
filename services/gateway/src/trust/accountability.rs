//! Advisory voucher accountability (C-1b-1). Pure quality scoring over a voucher's
//! vouchees' report outcomes. Surfaced (with sample size) in the Observatory; never
//! auto-enforced in C-1b-1 — operators act via vouching_suspended / vouch_budget_override.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityComponents {
    pub vouchee_count: i64,
    pub accurate_count: i64,
    pub rejected_count: i64,
    pub quality_ratio: f64,
    pub low_confidence: bool,
}

/// Quality components for a voucher: ratio over accurate vs rejected vouchee
/// reports, with sample size, and a low-confidence flag below `min_sample`.
#[allow(dead_code)] // used by the Observatory (Task 7)
pub fn quality_components(
    vouchee_count: i64,
    accurate: i64,
    rejected: i64,
    min_sample: u32,
) -> QualityComponents {
    let denom = (accurate + rejected).max(1);
    QualityComponents {
        vouchee_count,
        accurate_count: accurate,
        rejected_count: rejected,
        quality_ratio: accurate as f64 / denom as f64,
        low_confidence: vouchee_count < min_sample as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_and_components() {
        let q = quality_components(8, 30, 10, 5);
        assert_eq!(q.vouchee_count, 8);
        assert_eq!(q.accurate_count, 30);
        assert_eq!(q.rejected_count, 10);
        assert!((q.quality_ratio - 0.75).abs() < 1e-9);
        assert!(!q.low_confidence); // 8 >= 5
    }
    #[test]
    fn low_confidence_below_sample() {
        assert!(quality_components(2, 5, 0, 5).low_confidence);
        assert!(!quality_components(5, 5, 0, 5).low_confidence);
    }
    #[test]
    fn zero_outcomes_is_defined() {
        let q = quality_components(0, 0, 0, 5);
        assert_eq!(q.quality_ratio, 0.0); // denom max(0,1) => 0/1
        assert!(q.low_confidence);
    }
}
