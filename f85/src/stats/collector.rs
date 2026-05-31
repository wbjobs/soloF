use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::types::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStatsSnapshot {
    pub stream_id: StreamId,
    pub backend_addr: String,
    pub connected: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub send_requests: u64,
    pub send_acks: u64,
    pub last_activity: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationStatsSnapshot {
    pub assoc_id: AssociationId,
    pub state: String,
    pub total_bytes_sent: u64,
    pub total_bytes_received: u64,
    pub total_packets_sent: u64,
    pub total_packets_received: u64,
    pub active_streams: usize,
    pub stream_count: usize,
    pub stream_stats: Vec<StreamStatsSnapshot>,
    pub created_at: std::time::SystemTime,
    pub last_activity: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalStatsSnapshot {
    pub total_associations: usize,
    pub total_active_associations: usize,
    pub total_streams: usize,
    pub total_bytes_sent: u64,
    pub total_bytes_received: u64,
    pub total_packets_sent: u64,
    pub total_packets_received: u64,
    pub uptime_seconds: u64,
}

#[derive(Debug)]
struct StreamStatsInternal {
    stream_id: StreamId,
    backend_addr: String,
    connected: bool,
    bytes_sent: u64,
    bytes_received: u64,
    packets_sent: u64,
    packets_received: u64,
    send_requests: u64,
    send_acks: u64,
    last_activity: Option<std::time::SystemTime>,
}

impl StreamStatsInternal {
    fn new(stream_id: StreamId, backend_addr: String) -> Self {
        Self {
            stream_id,
            backend_addr,
            connected: false,
            bytes_sent: 0,
            bytes_received: 0,
            packets_sent: 0,
            packets_received: 0,
            send_requests: 0,
            send_acks: 0,
            last_activity: None,
        }
    }

    fn snapshot(&self) -> StreamStatsSnapshot {
        StreamStatsSnapshot {
            stream_id: self.stream_id,
            backend_addr: self.backend_addr.clone(),
            connected: self.connected,
            bytes_sent: self.bytes_sent,
            bytes_received: self.bytes_received,
            packets_sent: self.packets_sent,
            packets_received: self.packets_received,
            send_requests: self.send_requests,
            send_acks: self.send_acks,
            last_activity: self.last_activity,
        }
    }
}

#[derive(Debug)]
struct AssociationStatsInternal {
    assoc_id: AssociationId,
    state: AssociationState,
    stream_stats: HashMap<StreamId, StreamStatsInternal>,
    created_at: std::time::SystemTime,
    last_activity: Option<std::time::SystemTime>,
}

impl AssociationStatsInternal {
    fn new(assoc_id: AssociationId) -> Self {
        Self {
            assoc_id,
            state: AssociationState::Closed,
            stream_stats: HashMap::new(),
            created_at: std::time::SystemTime::now(),
            last_activity: None,
        }
    }

    fn total_bytes_sent(&self) -> u64 {
        self.stream_stats.values().map(|s| s.bytes_sent).sum()
    }

    fn total_bytes_received(&self) -> u64 {
        self.stream_stats.values().map(|s| s.bytes_received).sum()
    }

    fn total_packets_sent(&self) -> u64 {
        self.stream_stats.values().map(|s| s.packets_sent).sum()
    }

    fn total_packets_received(&self) -> u64 {
        self.stream_stats.values().map(|s| s.packets_received).sum()
    }

    fn snapshot(&self) -> AssociationStatsSnapshot {
        AssociationStatsSnapshot {
            assoc_id: self.assoc_id,
            state: format!("{:?}", self.state),
            total_bytes_sent: self.total_bytes_sent(),
            total_bytes_received: self.total_bytes_received(),
            total_packets_sent: self.total_packets_sent(),
            total_packets_received: self.total_packets_received(),
            active_streams: self.stream_stats.values().filter(|s| s.connected).count(),
            stream_count: self.stream_stats.len(),
            stream_stats: self
                .stream_stats
                .values()
                .map(|s| s.snapshot())
                .collect(),
            created_at: self.created_at,
            last_activity: self.last_activity,
        }
    }
}

#[derive(Debug)]
pub struct StatsCollector {
    associations: RwLock<HashMap<AssociationId, AssociationStatsInternal>>,
    start_time: Instant,
    total_bytes_sent: RwLock<u64>,
    total_bytes_received: RwLock<u64>,
    total_packets_sent: RwLock<u64>,
    total_packets_received: RwLock<u64>,
}

impl StatsCollector {
    pub fn new() -> Self {
        Self {
            associations: RwLock::new(HashMap::new()),
            start_time: Instant::now(),
            total_bytes_sent: RwLock::new(0),
            total_bytes_received: RwLock::new(0),
            total_packets_sent: RwLock::new(0),
            total_packets_received: RwLock::new(0),
        }
    }

    pub fn register_association(&self, assoc_id: AssociationId) {
        let mut associations = self.associations.write();
        if !associations.contains_key(&assoc_id) {
            associations.insert(assoc_id, AssociationStatsInternal::new(assoc_id));
            debug!(assoc_id = %assoc_id, "Registered association for stats");
        }
    }

    pub fn unregister_association(&self, assoc_id: AssociationId) {
        self.associations.write().remove(&assoc_id);
        debug!(assoc_id = %assoc_id, "Unregistered association from stats");
    }

    pub fn register_stream(
        &self,
        assoc_id: AssociationId,
        stream_id: StreamId,
        backend_addr: String,
    ) {
        let mut associations = self.associations.write();
        if let Some(assoc) = associations.get_mut(&assoc_id) {
            assoc
                .stream_stats
                .entry(stream_id)
                .or_insert_with(|| StreamStatsInternal::new(stream_id, backend_addr));
        }
    }

    pub fn set_stream_connected(&self, assoc_id: AssociationId, stream_id: StreamId, connected: bool) {
        let associations = self.associations.read();
        if let Some(assoc) = associations.get(&assoc_id) {
            if let Some(stream) = assoc.stream_stats.get(&stream_id) {
                // We need mutable access
                drop(associations);
                let mut associations = self.associations.write();
                if let Some(assoc) = associations.get_mut(&assoc_id) {
                    if let Some(stream) = assoc.stream_stats.get_mut(&stream_id) {
                        stream.connected = connected;
                        stream.last_activity = Some(std::time::SystemTime::now());
                    }
                }
            }
        }
    }

    pub fn update_association_state(
        &self,
        assoc_id: AssociationId,
        state: AssociationState,
    ) {
        let mut associations = self.associations.write();
        if let Some(assoc) = associations.get_mut(&assoc_id) {
            assoc.state = state;
            assoc.last_activity = Some(std::time::SystemTime::now());
        }
    }

    pub fn record_send(&self, assoc_id: AssociationId, stream_id: StreamId, bytes: u64) {
        let mut associations = self.associations.write();
        if let Some(assoc) = associations.get_mut(&assoc_id) {
            if let Some(stream) = assoc.stream_stats.get_mut(&stream_id) {
                stream.bytes_sent += bytes;
                stream.packets_sent += 1;
                stream.last_activity = Some(std::time::SystemTime::now());
            }
        }
        *self.total_bytes_sent.write() += bytes;
        *self.total_packets_sent.write() += 1;
    }

    pub fn record_recv(&self, assoc_id: AssociationId, stream_id: StreamId, bytes: u64) {
        let mut associations = self.associations.write();
        if let Some(assoc) = associations.get_mut(&assoc_id) {
            if let Some(stream) = assoc.stream_stats.get_mut(&stream_id) {
                stream.bytes_received += bytes;
                stream.packets_received += 1;
                stream.last_activity = Some(std::time::SystemTime::now());
            }
        }
        *self.total_bytes_received.write() += bytes;
        *self.total_packets_received.write() += 1;
    }

    pub fn record_send_request(&self, stream_id: StreamId, bytes: u64) {
        let associations = self.associations.write();
        for assoc in associations.values() {
            if assoc.stream_stats.contains_key(&stream_id) {
                drop(associations);
                let mut associations = self.associations.write();
                for assoc in associations.values_mut() {
                    if let Some(stream) = assoc.stream_stats.get_mut(&stream_id) {
                        stream.send_requests += 1;
                    }
                }
                break;
            }
        }
    }

    pub fn record_send_ack(&self, tsn: u32, stream_id: StreamId) {
        let associations = self.associations.write();
        for assoc in associations.values() {
            if assoc.stream_stats.contains_key(&stream_id) {
                drop(associations);
                let mut associations = self.associations.write();
                for assoc in associations.values_mut() {
                    if let Some(stream) = assoc.stream_stats.get_mut(&stream_id) {
                        stream.send_acks += 1;
                    }
                }
                break;
            }
        }
    }

    pub fn get_association_stats(
        &self,
        assoc_id: AssociationId,
        state: AssociationState,
    ) -> AssociationStats {
        let associations = self.associations.read();
        if let Some(assoc) = associations.get(&assoc_id) {
            let snapshot = assoc.snapshot();
            AssociationStats {
                assoc_id: snapshot.assoc_id,
                state: snapshot.state,
                total_bytes_sent: snapshot.total_bytes_sent,
                total_bytes_received: snapshot.total_bytes_received,
                total_packets_sent: snapshot.total_packets_sent,
                total_packets_received: snapshot.total_packets_received,
                active_streams: snapshot.active_streams,
                stream_stats: snapshot
                    .stream_stats
                    .into_iter()
                    .map(|s| StreamStats {
                        stream_id: s.stream_id,
                        backend_addr: s.backend_addr,
                        connected: s.connected,
                        bytes_sent: s.bytes_sent,
                        bytes_received: s.bytes_received,
                        packets_sent: s.packets_sent,
                        packets_received: s.packets_received,
                    })
                    .collect(),
            }
        } else {
            AssociationStats {
                assoc_id,
                state: format!("{:?}", state),
                total_bytes_sent: 0,
                total_bytes_received: 0,
                total_packets_sent: 0,
                total_packets_received: 0,
                active_streams: 0,
                stream_stats: Vec::new(),
            }
        }
    }

    pub fn get_global_stats(&self) -> GlobalStatsSnapshot {
        let associations = self.associations.read();
        GlobalStatsSnapshot {
            total_associations: associations.len(),
            total_active_associations: associations
                .values()
                .filter(|a| a.state == AssociationState::Established)
                .count(),
            total_streams: associations
                .values()
                .map(|a| a.stream_stats.len())
                .sum(),
            total_bytes_sent: *self.total_bytes_sent.read(),
            total_bytes_received: *self.total_bytes_received.read(),
            total_packets_sent: *self.total_packets_sent.read(),
            total_packets_received: *self.total_packets_received.read(),
            uptime_seconds: self.start_time.elapsed().as_secs(),
        }
    }

    pub fn get_all_association_stats(&self) -> Vec<AssociationStatsSnapshot> {
        let associations = self.associations.read();
        associations.values().map(|a| a.snapshot()).collect()
    }

    pub fn association_count(&self) -> usize {
        self.associations.read().len()
    }
}

impl Default for StatsCollector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stats_collection() {
        let collector = StatsCollector::new();
        collector.register_association(1);
        collector.register_stream(1, 0, "127.0.0.1:8080".to_string());
        collector.record_send(1, 0, 100);
        collector.record_recv(1, 0, 200);

        let stats = collector.get_association_stats(1, AssociationState::Established);
        assert_eq!(stats.total_bytes_sent, 100);
        assert_eq!(stats.total_bytes_received, 200);
    }

    #[test]
    fn test_global_stats() {
        let collector = StatsCollector::new();
        collector.register_association(1);
        collector.register_association(2);

        let stats = collector.get_global_stats();
        assert_eq!(stats.total_associations, 2);
    }
}
