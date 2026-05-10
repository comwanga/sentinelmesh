use bytes::Bytes;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

const CHANNEL_CAPACITY: usize = 64;

#[derive(Clone)]
pub struct CircleHub {
    senders: Arc<DashMap<Uuid, broadcast::Sender<Arc<Bytes>>>>,
}

impl CircleHub {
    pub fn new() -> Self {
        Self { senders: Arc::new(DashMap::new()) }
    }

    pub fn broadcast(&self, circle_id: Uuid, msg: Bytes) {
        if let Some(tx) = self.senders.get(&circle_id) {
            let _ = tx.send(Arc::new(msg));
        }
    }

    pub fn subscribe(&self, circle_id: Uuid) -> broadcast::Receiver<Arc<Bytes>> {
        self.senders
            .entry(circle_id)
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .subscribe()
    }
}

impl Default for CircleHub {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn circle_subscriber_receives_broadcast() {
        let hub = CircleHub::new();
        let id = Uuid::new_v4();
        let mut rx = hub.subscribe(id);
        hub.broadcast(id, Bytes::from_static(b"location"));
        let msg = rx.recv().await.unwrap();
        assert_eq!(&msg[..], b"location");
    }

    #[tokio::test]
    async fn different_circles_are_isolated() {
        let hub = CircleHub::new();
        let id_a = Uuid::new_v4();
        let id_b = Uuid::new_v4();
        let mut rx_a = hub.subscribe(id_a);
        hub.broadcast(id_b, Bytes::from_static(b"other"));
        assert!(rx_a.try_recv().is_err());
    }
}
