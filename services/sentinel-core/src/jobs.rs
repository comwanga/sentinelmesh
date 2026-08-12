use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobStatus {
    Pending,
    Processing,
    NostrPublished,
    BitcoinAnchored,
    Complete,
    Failed,
    Dead,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Pending => "PENDING",
            Self::Processing => "PROCESSING",
            Self::NostrPublished => "NOSTR_PUBLISHED",
            Self::BitcoinAnchored => "BITCOIN_ANCHORED",
            Self::Complete => "COMPLETE",
            Self::Failed => "FAILED",
            Self::Dead => "DEAD",
        };
        write!(f, "{s}")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SourceType {
    SafetyEvent,
    CommunityReport,
}

impl std::fmt::Display for SourceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SafetyEvent => write!(f, "SAFETY_EVENT"),
            Self::CommunityReport => write!(f, "COMMUNITY_REPORT"),
        }
    }
}

/// Row fetched from publish_jobs, matches the DB schema exactly.
#[derive(Debug, Clone)]
pub struct PublishJob {
    pub id: Uuid,
    pub source_type: String,
    pub source_id: Uuid,
    pub status: String,
    pub nostr_kind1_id: Option<String>,
    pub nostr_kind30078_id: Option<String>,
    pub bitcoin_txid: Option<String>,
    pub anchor_hash: Option<String>,
    pub retry_count: i32,
}

/// Data fetched from the source table (safety_events or community_reports).
#[derive(Debug, Clone)]
pub struct SourceRow {
    pub severity: String,
    pub event_type: String,
    pub lat: f64,
    pub lng: f64,
    pub place_name: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_status_display() {
        assert_eq!(JobStatus::NostrPublished.to_string(), "NOSTR_PUBLISHED");
        assert_eq!(JobStatus::BitcoinAnchored.to_string(), "BITCOIN_ANCHORED");
        assert_eq!(JobStatus::Dead.to_string(), "DEAD");
    }

    #[test]
    fn source_type_display() {
        assert_eq!(SourceType::SafetyEvent.to_string(), "SAFETY_EVENT");
        assert_eq!(SourceType::CommunityReport.to_string(), "COMMUNITY_REPORT");
    }
}
