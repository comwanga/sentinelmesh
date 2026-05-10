use anyhow::{anyhow, Result};
use nostr_sdk::{Client, EventBuilder, Keys, Kind, Tag, TagKind, Timestamp};
use sentinel_core::jobs::SourceRow;
use uuid::Uuid;

pub struct PublishResult {
    pub kind1_id: String,
    pub kind30078_id: String,
}

pub async fn publish_nostr_events(
    privkey_hex: &str,
    relay_urls: &[String],
    source_id: Uuid,
    source_type: &str,
    source: &SourceRow,
) -> Result<PublishResult> {
    let keys = Keys::parse(privkey_hex).map_err(|e| anyhow!("invalid NOSTR_PRIVKEY: {}", e))?;
    let client = Client::new(keys.clone());

    for url in relay_urls {
        client.add_relay(url).await?;
    }
    client.connect().await;

    // Resolve location before building events to avoid borrowing a temporary.
    let location_owned: String = source
        .place_name
        .clone()
        .unwrap_or_else(|| format!("{},{}", source.lat, source.lng));

    // Both events share the same timestamp, built before connecting to relays.
    let now = Timestamp::now();
    let severity_lower = source.severity.to_lowercase();

    let kind1 = EventBuilder::text_note(format!(
        "\u{1f6a8} {} {} reported at {}. #SentinelMesh",
        source.severity, source.event_type, location_owned,
    ))
    .tags([
        Tag::hashtag("sentinelmesh"),
        Tag::hashtag("safetymesh"),
        Tag::hashtag(&severity_lower),
    ])
    .custom_created_at(now)
    .sign_with_keys(&keys)?;

    let content_json = serde_json::json!({
        "event_id": source_id.to_string(),
        "severity": source.severity,
    });

    let kind30078 = EventBuilder::new(Kind::Custom(30078), content_json.to_string())
        .tags([
            Tag::identifier(format!("sentinelmesh:{}", source_id)),
            Tag::custom(TagKind::custom("source_type"), [source_type]),
            Tag::custom(TagKind::custom("source_id"), [source_id.to_string().as_str()]),
            Tag::custom(TagKind::custom("severity"), [source.severity.as_str()]),
            Tag::custom(TagKind::custom("event_type"), [source.event_type.as_str()]),
            Tag::custom(TagKind::custom("lat"), [source.lat.to_string().as_str()]),
            Tag::custom(TagKind::custom("lng"), [source.lng.to_string().as_str()]),
        ])
        .custom_created_at(now)
        .sign_with_keys(&keys)?;

    // Capture IDs before moving events into send_event (which takes ownership).
    let kind1_id = kind1.id.to_hex();
    let kind30078_id = kind30078.id.to_hex();

    // At least one relay must accept each event.
    let output1 = client.send_event(kind1).await?;
    if output1.success.is_empty() {
        client.disconnect().await?;
        return Err(anyhow!("all relays rejected kind 1 event"));
    }

    let output2 = client.send_event(kind30078).await?;
    if output2.success.is_empty() {
        client.disconnect().await?;
        return Err(anyhow!("all relays rejected kind 30078 event"));
    }

    client.disconnect().await?;

    Ok(PublishResult {
        kind1_id,
        kind30078_id,
    })
}
