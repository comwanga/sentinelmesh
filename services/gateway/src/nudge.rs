use reqwest::Client;

pub fn nudge_blockchain(client: Client, base_url: String) {
    tokio::spawn(async move {
        let url = format!("{base_url}/internal/nudge");
        match client
            .post(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {}
            Ok(r) => tracing::warn!("blockchain nudge returned {}", r.status()),
            Err(e) => tracing::warn!("blockchain nudge failed: {e}"),
        }
    });
}
