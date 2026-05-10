// placeholder — implemented in Task 5
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
