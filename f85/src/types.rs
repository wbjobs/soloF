use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

pub type AssociationId = u32;
pub type StreamId = u16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationConfig {
    pub assoc_id: AssociationId,
    pub local_addr: SocketAddr,
    pub remote_addr: SocketAddr,
    pub streams: Vec<StreamConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamConfig {
    pub stream_id: StreamId,
    pub backend_addr: SocketAddr,
    pub qos: QoSConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoSConfig {
    pub priority: u8,
    pub bandwidth_limit_bps: Option<u64>,
}

impl Default for QoSConfig {
    fn default() -> Self {
        Self {
            priority: 5,
            bandwidth_limit_bps: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssociationState {
    Closed,
    CookieWait,
    CookieEchoed,
    Established,
    ShutdownPending,
    ShutdownSent,
    ShutdownReceived,
    ShutdownAckSent,
}

#[derive(Debug, Clone)]
pub struct Association {
    pub config: AssociationConfig,
    pub state: AssociationState,
    pub streams: HashMap<StreamId, Arc<RwLock<StreamState>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamState {
    pub stream_id: StreamId,
    pub backend_addr: SocketAddr,
    pub connected: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
    pub last_activity: Option<std::time::Instant>,
}

impl StreamState {
    pub fn new(stream_id: StreamId, backend_addr: SocketAddr) -> Self {
        Self {
            stream_id,
            backend_addr,
            connected: false,
            bytes_sent: 0,
            bytes_received: 0,
            packets_sent: 0,
            packets_received: 0,
            last_activity: None,
        }
    }

    pub fn record_send(&mut self, bytes: u64) {
        self.bytes_sent += bytes;
        self.packets_sent += 1;
        self.last_activity = Some(std::time::Instant::now());
    }

    pub fn record_recv(&mut self, bytes: u64) {
        self.bytes_received += bytes;
        self.packets_received += 1;
        self.last_activity = Some(std::time::Instant::now());
    }
}

#[derive(Debug, Clone)]
pub struct PathState {
    pub interface_name: String,
    pub local_addr: SocketAddr,
    pub active: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub last_heartbeat: Option<std::time::Instant>,
    pub heartbeat_interval: std::time::Duration,
    pub rtt: std::time::Duration,
}

impl PathState {
    pub fn new(interface_name: String, local_addr: SocketAddr) -> Self {
        Self {
            interface_name,
            local_addr,
            active: true,
            bytes_sent: 0,
            bytes_received: 0,
            last_heartbeat: None,
            heartbeat_interval: std::time::Duration::from_secs(30),
            rtt: std::time::Duration::from_millis(100),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssociationStats {
    pub assoc_id: AssociationId,
    pub state: String,
    pub total_bytes_sent: u64,
    pub total_bytes_received: u64,
    pub total_packets_sent: u64,
    pub total_packets_received: u64,
    pub active_streams: usize,
    pub stream_stats: Vec<StreamStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamStats {
    pub stream_id: StreamId,
    pub backend_addr: String,
    pub connected: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub packets_sent: u64,
    pub packets_received: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderingStatsResponse {
    pub total_packets: u64,
    pub out_of_order_packets: u64,
    pub reorder_rate: f64,
    pub max_reorder_gap: u32,
    pub avg_reorder_gap: f64,
    pub reorder_events: u64,
    pub forward_tsn_count: u64,
    pub avg_reorder_delay_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAssociationRequest {
    pub assoc_id: AssociationId,
    pub local_addr: String,
    pub remote_addr: String,
    pub streams: Vec<StreamMappingRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMappingRequest {
    pub stream_id: StreamId,
    pub backend_addr: String,
    pub priority: Option<u8>,
    pub bandwidth_limit_bps: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub message: String,
    pub data: Option<T>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            message: "ok".to_string(),
            data: Some(data),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: None,
        }
    }
}
