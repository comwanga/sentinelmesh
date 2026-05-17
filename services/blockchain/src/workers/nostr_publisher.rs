use anyhow::{anyhow, Result};
use futures::future::join_all;
use nostr_sdk::{Client, EventBuilder, Keys, Kind, Tag, TagKind, Timestamp};
use sentinel_core::jobs::SourceRow;
use std::time::Duration;
use tokio::time::timeout;
use uuid::Uuid;

const RELAY_TIMEOUT: Duration = Duration::from_secs(10);

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
    let result = send_events(&client, relay_urls, kind1, kind30078, &kind1_id, &kind30078_id).await;
    client.disconnect().await.ok();
    result?;

    Ok(PublishResult { kind1_id, kind30078_id })
}

async fn send_events(
    client: &Client,
    relay_urls: &[String],
    kind1: nostr_sdk::Event,
    kind30078: nostr_sdk::Event,
    kind1_id: &str,
    kind30078_id: &str,
) -> Result<()> {
    let kind1_ok = send_event_per_relay(client, relay_urls, kind1, kind1_id).await?;
    if !kind1_ok {
        return Err(anyhow!("all relays timed out or failed for kind 1 event ({})", kind1_id));
    }

    let kind30078_ok = send_event_per_relay(client, relay_urls, kind30078, kind30078_id).await?;
    if !kind30078_ok {
        return Err(anyhow!("all relays timed out or failed for kind 30078 event ({})", kind30078_id));
    }

    Ok(())
}

// Sends one event to all relays in parallel, each wrapped in RELAY_TIMEOUT.
// Returns true if at least one relay accepted the event.
async fn send_event_per_relay(
    client: &Client,
    relay_urls: &[String],
    event: nostr_sdk::Event,
    event_id: &str,
) -> Result<bool> {
    let futs: Vec<_> = relay_urls.iter().map(|url| {
        let client = client.clone();
        let url = url.clone();
        let event = event.clone();
        let event_id = event_id.to_string();
        async move {
            let fut = client.send_event_to([url.as_str()], event);
            match timeout(RELAY_TIMEOUT, fut).await {
                Ok(Ok(output)) if !output.success.is_empty() => {
                    tracing::info!("event {} published to relay {}", event_id, url);
                    true
                }
                Ok(Ok(output)) => {
                    let reasons = relay_failure_summary(&output.failed);
                    tracing::warn!("relay {} rejected event {}: {}", url, event_id, reasons);
                    false
                }
                Ok(Err(e)) => {
                    tracing::warn!("relay {} error for event {}: {}", url, event_id, e);
                    false
                }
                Err(_elapsed) => {
                    tracing::warn!(
                        "relay {} timed out after {}s for event {}",
                        url, RELAY_TIMEOUT.as_secs(), event_id
                    );
                    false
                }
            }
        }
    }).collect();

    let results = join_all(futs).await;
    Ok(results.into_iter().any(|ok| ok))
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
