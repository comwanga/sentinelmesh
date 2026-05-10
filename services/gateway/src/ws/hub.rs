use bytes::Bytes;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct WsHub {
    senders: Arc<DashMap<String, broadcast::Sender<Arc<Bytes>>>>,
}

impl WsHub {
    pub fn new() -> Self {
        Self { senders: Arc::new(DashMap::new()) }
    }

    /// Broadcast bytes to a specific county channel AND the "global" channel.
    /// If county is None, broadcasts to global only.
    pub fn broadcast(&self, county: Option<&str>, msg: Bytes) {
        let arc = Arc::new(msg);
        if let Some(c) = county {
            if let Some(tx) = self.senders.get(c) {
                let _ = tx.send(arc.clone());
            }
        }
        if let Some(tx) = self.senders.get("global") {
            let _ = tx.send(arc);
        }
    }

    /// Returns a receiver for the given county key (creates the channel if absent).
    /// Use "global" for clients that want all events regardless of county.
    pub fn subscribe(&self, county: &str) -> broadcast::Receiver<Arc<Bytes>> {
        self.senders
            .entry(county.to_string())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

impl Default for WsHub {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn county_subscriber_receives_broadcast() {
        let hub = WsHub::new();
        let mut rx = hub.subscribe("nairobi");
        hub.broadcast(Some("nairobi"), Bytes::from_static(b"hello"));
        let msg = rx.recv().await.unwrap();
        assert_eq!(&msg[..], b"hello");
    }

    #[tokio::test]
    async fn global_subscriber_receives_all_broadcasts() {
        let hub = WsHub::new();
        let mut global = hub.subscribe("global");
        hub.broadcast(Some("mombasa"), Bytes::from_static(b"event1"));
        let msg = global.recv().await.unwrap();
        assert_eq!(&msg[..], b"event1");
    }

    #[tokio::test]
    async fn county_subscriber_does_not_receive_other_county() {
        let hub = WsHub::new();
        let mut nairobi = hub.subscribe("nairobi");
        hub.broadcast(Some("mombasa"), Bytes::from_static(b"other"));
        assert!(nairobi.try_recv().is_err());
    }
}
