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

    // Resolve location and bind temporaries before building events.
    let location_owned: String = source
        .place_name
        .clone()
        .unwrap_or_else(|| format!("{},{}", source.lat, source.lng));
    let now = Timestamp::now();
    let severity_lower = source.severity.to_lowercase();
    let source_id_str = source_id.to_string();
    let lat_str = source.lat.to_string();
    let lng_str = source.lng.to_string();

    // Sign both events using `&keys` before moving keys into the client.
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
        "event_id": source_id_str,
        "severity": source.severity,
    });

    let kind30078 = EventBuilder::new(Kind::Custom(30078), content_json.to_string())
        .tags([
            Tag::identifier(format!("sentinelmesh:{}", source_id_str)),
            Tag::custom(TagKind::custom("source_type"), [source_type]),
            Tag::custom(TagKind::custom("source_id"),   [source_id_str.as_str()]),
            Tag::custom(TagKind::custom("severity"),    [source.severity.as_str()]),
            Tag::custom(TagKind::custom("event_type"),  [source.event_type.as_str()]),
            Tag::custom(TagKind::custom("lat"),         [lat_str.as_str()]),
            Tag::custom(TagKind::custom("lng"),         [lng_str.as_str()]),
        ])
        .custom_created_at(now)
        .sign_with_keys(&keys)?;

    // Capture IDs before events are moved into send_event.
    let kind1_id = kind1.id.to_hex();
    let kind30078_id = kind30078.id.to_hex();

    // Move keys into the client only after signing is complete.
    let client = Client::new(keys);
    for url in relay_urls {
        client.add_relay(url).await?;
    }
    client.connect().await; // returns () in nostr-sdk 0.37

    // Publish, then disconnect unconditionally regardless of outcome.
    let result = send_events(&client, kind1, kind30078, &kind1_id, &kind30078_id).await;
    client.disconnect().await.ok();
    result?;

    Ok(PublishResult { kind1_id, kind30078_id })
}

async fn send_events(
    client: &Client,
    kind1: nostr_sdk::Event,
    kind30078: nostr_sdk::Event,
    kind1_id: &str,
    kind30078_id: &str,
) -> Result<()> {
    let output1 = client.send_event(kind1).await?;
    if output1.success.is_empty() {
        let reasons = relay_failure_summary(&output1.failed);
        return Err(anyhow!("all relays rejected kind 1 event ({}): {}", kind1_id, reasons));
    }
    tracing::info!("kind 1 published ({}) to {} relay(s)", kind1_id, output1.success.len());

    let output2 = client.send_event(kind30078).await?;
    if output2.success.is_empty() {
        let reasons = relay_failure_summary(&output2.failed);
        return Err(anyhow!("all relays rejected kind 30078 event ({}): {}", kind30078_id, reasons));
    }
    tracing::info!("kind 30078 published ({}) to {} relay(s)", kind30078_id, output2.success.len());

    Ok(())
}

fn relay_failure_summary(failed: &std::collections::HashMap<nostr_sdk::RelayUrl, Option<String>>) -> String {
    if failed.is_empty() {
        return "no relay error details available".into();
    }
    failed
        .iter()
        .map(|(url, reason)| match reason {
            Some(r) => format!("{url}: {r}"),
            None => format!("{url}: rejected"),
        })
        .collect::<Vec<_>>()
        .join(", ")
}
