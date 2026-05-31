use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket as AsyncUdpSocket;
use tracing::{debug, error, info, warn};

use crate::types::*;

pub const DEFAULT_MTU: u32 = 1500;
pub const SCTP_OVERHEAD: usize = 12;
pub const CHUNK_HEADER_OVERHEAD: usize = 4;
pub const DATA_CHUNK_OVERHEAD: usize = 16;

pub const DEFAULT_HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(5);
pub const DEFAULT_RTT_HISTORY_SIZE: usize = 20;
pub const DEFAULT_PACKET_LOSS_WINDOW: usize = 50;
pub const DEFAULT_MAX_RTT_THRESHOLD_MS: u64 = 500;
pub const DEFAULT_MAX_PACKET_LOSS_RATE: f64 = 0.1;
pub const DEFAULT_HEALTHY_RTT_THRESHOLD_MS: u64 = 200;
pub const DEFAULT_HEALTHY_PACKET_LOSS_RATE: f64 = 0.02;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathHealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Failed,
}

impl std::fmt::Display for PathHealthStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PathHealthStatus::Healthy => write!(f, "Healthy"),
            PathHealthStatus::Degraded => write!(f, "Degraded"),
            PathHealthStatus::Unhealthy => write!(f, "Unhealthy"),
            PathHealthStatus::Failed => write!(f, "Failed"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathHealthStats {
    pub name: String,
    pub status: PathHealthStatus,
    pub current_rtt_ms: u64,
    pub avg_rtt_ms: u64,
    pub min_rtt_ms: u64,
    pub max_rtt_ms: u64,
    pub packet_loss_rate: f64,
    pub packets_sent: u64,
    pub packets_lost: u64,
    pub consecutive_failures: u32,
    pub last_healthy_time: Option<std::time::SystemTime>,
    pub last_failure_time: Option<std::time::SystemTime>,
    pub failover_count: u32,
}

#[derive(Debug, Clone)]
pub struct PathInterface {
    pub name: String,
    pub local_addr: SocketAddr,
    pub socket: Option<Arc<AsyncUdpSocket>>,
    pub active: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub last_heartbeat: Option<Instant>,
    pub heartbeat_interval: Duration,
    pub rtt: Duration,
    pub cwnd: u32,
    pub ssthresh: u32,
    pub mtu: u32,
    pub health_status: PathHealthStatus,
    pub rtt_history: VecDeque<Duration>,
    pub rtt_history_max_size: usize,
    pub packets_sent: u64,
    pub packets_lost: u64,
    pub packet_loss_window: VecDeque<bool>,
    pub packet_loss_window_max_size: usize,
    pub consecutive_failures: u32,
    pub max_consecutive_failures: u32,
    pub last_healthy_time: Option<std::time::SystemTime>,
    pub last_failure_time: Option<std::time::SystemTime>,
    pub failover_count: u32,
    pub health_check_interval: Duration,
    pub last_health_check: Option<Instant>,
    pub pending_heartbeats: HashMap<u32, Instant>,
    pub max_rtt_threshold: Duration,
    pub max_packet_loss_rate: f64,
    pub healthy_rtt_threshold: Duration,
    pub healthy_packet_loss_rate: f64,
}

impl PathInterface {
    pub fn new(name: String, local_addr: SocketAddr) -> Self {
        Self {
            name,
            local_addr,
            socket: None,
            active: true,
            bytes_sent: 0,
            bytes_received: 0,
            last_heartbeat: None,
            heartbeat_interval: Duration::from_secs(30),
            rtt: Duration::from_millis(100),
            cwnd: DEFAULT_MTU * 4,
            ssthresh: DEFAULT_MTU * 8,
            mtu: DEFAULT_MTU,
            health_status: PathHealthStatus::Healthy,
            rtt_history: VecDeque::with_capacity(DEFAULT_RTT_HISTORY_SIZE),
            rtt_history_max_size: DEFAULT_RTT_HISTORY_SIZE,
            packets_sent: 0,
            packets_lost: 0,
            packet_loss_window: VecDeque::with_capacity(DEFAULT_PACKET_LOSS_WINDOW),
            packet_loss_window_max_size: DEFAULT_PACKET_LOSS_WINDOW,
            consecutive_failures: 0,
            max_consecutive_failures: 5,
            last_healthy_time: Some(std::time::SystemTime::now()),
            last_failure_time: None,
            failover_count: 0,
            health_check_interval: DEFAULT_HEALTH_CHECK_INTERVAL,
            last_health_check: None,
            pending_heartbeats: HashMap::new(),
            max_rtt_threshold: Duration::from_millis(DEFAULT_MAX_RTT_THRESHOLD_MS),
            max_packet_loss_rate: DEFAULT_MAX_PACKET_LOSS_RATE,
            healthy_rtt_threshold: Duration::from_millis(DEFAULT_HEALTHY_RTT_THRESHOLD_MS),
            healthy_packet_loss_rate: DEFAULT_HEALTHY_PACKET_LOSS_RATE,
        }
    }

    pub fn max_payload_size(&self) -> usize {
        self.mtu as usize - SCTP_OVERHEAD - CHUNK_HEADER_OVERHEAD - DATA_CHUNK_OVERHEAD
    }

    pub fn needs_heartbeat(&self) -> bool {
        self.last_heartbeat
            .map(|t| t.elapsed() >= self.heartbeat_interval)
            .unwrap_or(true)
    }

    pub fn needs_health_check(&self) -> bool {
        self.last_health_check
            .map(|t| t.elapsed() >= self.health_check_interval)
            .unwrap_or(true)
    }

    pub fn record_sent(&mut self, bytes: usize) {
        self.bytes_sent += bytes as u64;
        self.packets_sent += 1;
        self.packet_loss_window.push_back(true);
        if self.packet_loss_window.len() > self.packet_loss_window_max_size {
            self.packet_loss_window.pop_front();
        }
    }

    pub fn record_received(&mut self, bytes: usize) {
        self.bytes_received += bytes as u64;
    }

    pub fn record_rtt(&mut self, rtt: Duration) {
        self.rtt = rtt;
        self.rtt_history.push_back(rtt);
        if self.rtt_history.len() > self.rtt_history_max_size {
            self.rtt_history.pop_front();
        }
    }

    pub fn record_packet_loss(&mut self) {
        self.packets_lost += 1;
        if let Some(last) = self.packet_loss_window.back_mut() {
            *last = false;
        }
        self.consecutive_failures += 1;
        if self.consecutive_failures >= self.max_consecutive_failures {
            self.mark_as_failed();
        }
    }

    pub fn mark_as_failed(&mut self) {
        if self.health_status != PathHealthStatus::Failed {
            self.health_status = PathHealthStatus::Failed;
            self.last_failure_time = Some(std::time::SystemTime::now());
            self.failover_count += 1;
            warn!(path = %self.name, "Path marked as FAILED after {} consecutive failures", self.consecutive_failures);
        }
    }

    pub fn mark_as_healthy(&mut self) {
        if self.health_status != PathHealthStatus::Healthy {
            self.health_status = PathHealthStatus::Healthy;
            self.last_healthy_time = Some(std::time::SystemTime::now());
            self.consecutive_failures = 0;
            info!(path = %self.name, "Path recovered to HEALTHY status");
        }
    }

    pub fn mark_as_degraded(&mut self) {
        if self.health_status == PathHealthStatus::Healthy {
            self.health_status = PathHealthStatus::Degraded;
            warn!(path = %self.name, "Path marked as DEGRADED");
        }
    }

    pub fn mark_as_unhealthy(&mut self) {
        if self.health_status != PathHealthStatus::Failed {
            self.health_status = PathHealthStatus::Unhealthy;
            warn!(path = %self.name, "Path marked as UNHEALTHY");
        }
    }

    pub fn is_healthy(&self) -> bool {
        self.health_status == PathHealthStatus::Healthy || self.health_status == PathHealthStatus::Degraded
    }

    pub fn is_available(&self) -> bool {
        self.active && self.health_status != PathHealthStatus::Failed
    }

    pub fn current_packet_loss_rate(&self) -> f64 {
        if self.packet_loss_window.is_empty() {
            return 0.0;
        }
        let successful = self.packet_loss_window.iter().filter(|&&s| s).count() as f64;
        let total = self.packet_loss_window.len() as f64;
        1.0 - (successful / total)
    }

    pub fn avg_rtt(&self) -> Duration {
        if self.rtt_history.is_empty() {
            return self.rtt;
        }
        let total: Duration = self.rtt_history.iter().sum();
        total / self.rtt_history.len() as u32
    }

    pub fn min_rtt(&self) -> Duration {
        self.rtt_history.iter().copied().min().unwrap_or(self.rtt)
    }

    pub fn max_rtt(&self) -> Duration {
        self.rtt_history.iter().copied().max().unwrap_or(self.rtt)
    }

    pub fn evaluate_health(&mut self) -> PathHealthStatus {
        let loss_rate = self.current_packet_loss_rate();
        let avg_rtt = self.avg_rtt();

        if avg_rtt > self.max_rtt_threshold || loss_rate > self.max_packet_loss_rate {
            self.mark_as_failed();
        } else if avg_rtt > self.healthy_rtt_threshold || loss_rate > self.healthy_packet_loss_rate {
            self.mark_as_unhealthy();
        } else if loss_rate > self.healthy_packet_loss_rate * 0.5 || avg_rtt > self.healthy_rtt_threshold * 0.5 {
            self.mark_as_degraded();
        } else {
            self.mark_as_healthy();
        }

        self.last_health_check = Some(Instant::now());
        self.health_status
    }

    pub fn get_health_stats(&self) -> PathHealthStats {
        PathHealthStats {
            name: self.name.clone(),
            status: self.health_status,
            current_rtt_ms: self.rtt.as_millis() as u64,
            avg_rtt_ms: self.avg_rtt().as_millis() as u64,
            min_rtt_ms: self.min_rtt().as_millis() as u64,
            max_rtt_ms: self.max_rtt().as_millis() as u64,
            packet_loss_rate: self.current_packet_loss_rate(),
            packets_sent: self.packets_sent,
            packets_lost: self.packets_lost,
            consecutive_failures: self.consecutive_failures,
            last_healthy_time: self.last_healthy_time,
            last_failure_time: self.last_failure_time,
            failover_count: self.failover_count,
        }
    }

    pub fn handle_congestion_event(&mut self) {
        self.ssthresh = (self.cwnd / 2).max(self.mtu * 2);
        self.cwnd = self.ssthresh;
    }
}

pub enum DistributionStrategy {
    RoundRobin,
    LeastLoaded,
    WeightedRoundRobin(Vec<u32>),
    Random,
    FlowAffinity,
    LowestRTT,
    LowestLatency,
}

impl Default for DistributionStrategy {
    fn default() -> Self {
        DistributionStrategy::FlowAffinity
    }
}

pub struct PathManager {
    paths: HashMap<String, Arc<RwLock<PathInterface>>>,
    strategy: DistributionStrategy,
    current_path_index: Arc<parking_lot::Mutex<usize>>,
    mtu: u32,
    flow_affinity_map: Arc<RwLock<HashMap<(AssociationId, StreamId), String>>>,
    rebalance_threshold_ms: u64,
    failed_flow_migrations: u64,
    total_migrations: u64,
}

impl PathManager {
    pub fn new() -> Self {
        Self {
            paths: HashMap::new(),
            strategy: DistributionStrategy::default(),
            current_path_index: Arc::new(parking_lot::Mutex::new(0)),
            mtu: DEFAULT_MTU,
            flow_affinity_map: Arc::new(RwLock::new(HashMap::new())),
            rebalance_threshold_ms: 50,
            failed_flow_migrations: 0,
            total_migrations: 0,
        }
    }

    pub fn with_strategy(strategy: DistributionStrategy) -> Self {
        Self {
            paths: HashMap::new(),
            strategy,
            current_path_index: Arc::new(parking_lot::Mutex::new(0)),
            mtu: DEFAULT_MTU,
            flow_affinity_map: Arc::new(RwLock::new(HashMap::new())),
            rebalance_threshold_ms: 50,
            failed_flow_migrations: 0,
            total_migrations: 0,
        }
    }

    pub fn mtu(&self) -> u32 {
        self.mtu
    }

    pub fn set_mtu(&mut self, mtu: u32) {
        self.mtu = mtu;
        for path in self.paths.values() {
            path.write().mtu = mtu;
        }
    }

    pub fn add_path(
        &mut self,
        name: String,
        local_addr: SocketAddr,
    ) -> Result<(), PathError> {
        if self.paths.contains_key(&name) {
            return Err(PathError::PathAlreadyExists(name));
        }

        let path = PathInterface::new(name.clone(), local_addr);
        self.paths.insert(name, Arc::new(RwLock::new(path)));

        Ok(())
    }

    pub async fn bind_path_socket(
        &self,
        name: &str,
    ) -> Result<(), PathError> {
        let path = self
            .paths
            .get(name)
            .ok_or_else(|| PathError::PathNotFound(name.to_string()))?;

        let addr = path.read().local_addr;
        let socket = AsyncUdpSocket::bind(addr)
            .await
            .map_err(|e| PathError::BindError(e.to_string()))?;

        info!(path = %name, addr = %addr, "Bound path socket");
        path.write().socket = Some(Arc::new(socket));
        Ok(())
    }

    pub fn remove_path(&mut self, name: &str) -> Result<(), PathError> {
        if self.paths.remove(name).is_none() {
            return Err(PathError::PathNotFound(name.to_string()));
        }

        self.remove_affinity_for_path(name);
        Ok(())
    }

    pub fn set_path_active(&self, name: &str, active: bool) -> Result<(), PathError> {
        let path = self
            .paths
            .get(name)
            .ok_or_else(|| PathError::PathNotFound(name.to_string()))?;
        path.write().active = active;

        if !active {
            self.remove_affinity_for_path(name);
        }
        Ok(())
    }

    pub fn active_paths(&self) -> Vec<Arc<RwLock<PathInterface>>> {
        self.paths
            .values()
            .filter(|p| p.read().is_available())
            .cloned()
            .collect()
    }

    pub fn healthy_paths(&self) -> Vec<Arc<RwLock<PathInterface>>> {
        self.paths
            .values()
            .filter(|p| p.read().is_healthy())
            .cloned()
            .collect()
    }

    pub fn select_path(&self) -> Option<Arc<RwLock<PathInterface>>> {
        self.select_path_for_flow(0, 0)
    }

    pub fn select_path_for_flow(
        &self,
        assoc_id: AssociationId,
        stream_id: StreamId,
    ) -> Option<Arc<RwLock<PathInterface>>> {
        let active = self.active_paths();
        if active.is_empty() {
            return None;
        }

        match &self.strategy {
            DistributionStrategy::RoundRobin => {
                let mut idx = self.current_path_index.lock();
                let path = active[*idx % active.len()].clone();
                *idx = (*idx + 1) % active.len();
                Some(path)
            }
            DistributionStrategy::LeastLoaded => {
                let min_path = active
                    .iter()
                    .min_by_key(|p| p.read().bytes_sent)
                    .cloned();
                min_path
            }
            DistributionStrategy::WeightedRoundRobin(weights) => {
                let total_weight: u32 = weights.iter().sum();
                if total_weight == 0 {
                    return active.into_iter().next();
                }

                let mut idx = self.current_path_index.lock();
                let mut cumulative = 0u32;
                let selected_idx = *idx % total_weight as usize;

                for (i, &weight) in weights.iter().enumerate() {
                    cumulative += weight;
                    if selected_idx < cumulative as usize {
                        let path = active[i % active.len()].clone();
                        *idx = (*idx + 1) % total_weight as usize;
                        return Some(path);
                    }
                }

                let path = active[*idx % active.len()].clone();
                *idx = (*idx + 1) % active.len();
                Some(path)
            }
            DistributionStrategy::Random => {
                use rand::Rng;
                let mut rng = rand::thread_rng();
                let idx = rng.gen_range(0..active.len());
                Some(active[idx].clone())
            }
            DistributionStrategy::FlowAffinity => {
                self.select_path_flow_affinity(assoc_id, stream_id, &active)
            }
            DistributionStrategy::LowestRTT => {
                self.select_path_lowest_rtt(&active)
            }
            DistributionStrategy::LowestLatency => {
                self.select_path_lowest_latency(&active)
            }
        }
    }

    fn select_path_flow_affinity(
        &self,
        assoc_id: AssociationId,
        stream_id: StreamId,
        active_paths: &[Arc<RwLock<PathInterface>>],
    ) -> Option<Arc<RwLock<PathInterface>>> {
        let flow_key = (assoc_id, stream_id);
        let mut affinity_map = self.flow_affinity_map.write();

        if let Some(path_name) = affinity_map.get(&flow_key) {
            if let Some(path) = self.paths.get(path_name) {
                if path.read().is_available() {
                    return Some(path.clone());
                } else {
                    warn!(
                        "Path {} is not available for flow ({}, {}), migrating...",
                        path_name, assoc_id, stream_id
                    );
                    self.total_migrations += 1;
                    affinity_map.remove(&flow_key);
                }
            }
        }

        let healthy = active_paths
            .iter()
            .filter(|p| p.read().is_healthy())
            .collect::<Vec<_>>();

        let available = if healthy.is_empty() {
            active_paths
        } else {
            &healthy
        };

        if available.is_empty() {
            return None;
        }

        let path_index = ((assoc_id as u64 ^ stream_id as u64) % available.len() as u64) as usize;
        let selected_path = &available[path_index];
        affinity_map.insert(flow_key, selected_path.read().name.clone());

        Some(selected_path.clone())
    }

    fn select_path_lowest_rtt(
        &self,
        active_paths: &[Arc<RwLock<PathInterface>>],
    ) -> Option<Arc<RwLock<PathInterface>>> {
        let healthy: Vec<_> = active_paths
            .iter()
            .filter(|p| p.read().is_healthy())
            .collect();

        let available = if healthy.is_empty() {
            active_paths
        } else {
            &healthy
        };

        available
            .iter()
            .min_by_key(|p| p.read().rtt.as_millis() as u64)
            .cloned()
    }

    fn select_path_lowest_latency(
        &self,
        active_paths: &[Arc<RwLock<PathInterface>>],
    ) -> Option<Arc<RwLock<PathInterface>>> {
        let healthy: Vec<_> = active_paths
            .iter()
            .filter(|p| p.read().is_healthy())
            .collect();

        let available = if healthy.is_empty() {
            active_paths
        } else {
            &healthy
        };

        available
            .iter()
            .min_by_key(|p| {
                let rtt = p.read().rtt.as_millis() as u64;
                let cwnd = p.read().cwnd as u64;
                rtt * 1000 / (cwnd + 1)
            })
            .cloned()
    }

    pub fn rebalance_flow(&self, assoc_id: AssociationId, stream_id: StreamId) {
        let flow_key = (assoc_id, stream_id);
        let healthy = self.healthy_paths();
        if healthy.is_empty() {
            return;
        }

        let best_path = healthy
            .iter()
            .min_by_key(|p| p.read().rtt.as_millis() as u64)
            .map(|p| p.read().name.clone());

        if let Some(best_name) = best_path {
            let mut map = self.flow_affinity_map.write();
            if map.get(&flow_key) != Some(&best_name) {
                map.insert(flow_key, best_name);
                self.total_migrations += 1;
            }
        }
    }

    pub fn clear_flow_affinity(&self, assoc_id: AssociationId, stream_id: StreamId) {
        self.flow_affinity_map.write().remove(&(assoc_id, stream_id));
    }

    pub fn clear_all_affinity_for_assoc(&self, assoc_id: AssociationId) {
        let mut map = self.flow_affinity_map.write();
        map.retain(|&(a, _), _| a != assoc_id);
    }

    pub fn remove_affinity_for_path(&self, path_name: &str) {
        let mut map = self.flow_affinity_map.write();
        map.retain(|_, v| v != path_name);
    }

    pub fn migrate_affected_flows(&self, path_name: &str) -> usize {
        let mut map = self.flow_affinity_map.write();
        let mut migrated = 0;

        let affected_flows: Vec<_> = map
            .iter()
            .filter(|(_, v)| *v == path_name)
            .map(|(k, _)| *k)
            .collect();

        drop(map);

        let healthy = self.healthy_paths();
        if healthy.is_empty() {
            return 0;
        }

        let mut map = self.flow_affinity_map.write();
        for flow_key in affected_flows {
            let (assoc_id, stream_id) = flow_key;
            let path_index = ((assoc_id as u64 ^ stream_id as u64) % healthy.len() as u64) as usize;
            let new_path = &healthy[path_index];
            map.insert(flow_key, new_path.read().name.clone());
            migrated += 1;
        }

        if migrated > 0 {
            self.failed_flow_migrations += migrated as u64;
            info!(
                "Migrated {} flows from failed path {} to healthy paths",
                migrated, path_name
            );
        }

        migrated
    }

    pub fn set_rebalance_threshold(&mut self, threshold_ms: u64) {
        self.rebalance_threshold_ms = threshold_ms;
    }

    pub fn check_all_health(&self) -> HashMap<String, PathHealthStatus> {
        let mut results = HashMap::new();
        let names: Vec<String> = self.paths.keys().cloned().collect();

        for name in names {
            if let Some(path) = self.paths.get(&name) {
                let mut p = path.write();
                let old_status = p.health_status;
                let new_status = p.evaluate_health();
                results.insert(name.clone(), new_status);

                if old_status == PathHealthStatus::Failed && new_status != PathHealthStatus::Failed {
                    info!(path = %name, "Path recovered from FAILED to {}", new_status);
                } else if old_status != PathHealthStatus::Failed && new_status == PathHealthStatus::Failed {
                    warn!(path = %name, "Path failed, migrating flows...");
                    drop(p);
                    self.migrate_affected_flows(&name);
                }
            }
        }

        results
    }

    pub fn get_all_health_stats(&self) -> Vec<PathHealthStats> {
        self.paths
            .values()
            .map(|p| p.read().get_health_stats())
            .collect()
    }

    pub fn get_path_health_stats(&self, name: &str) -> Option<PathHealthStats> {
        self.paths.get(name).map(|p| p.read().get_health_stats())
    }

    pub fn migration_stats(&self) -> (u64, u64) {
        (self.total_migrations, self.failed_flow_migrations)
    }

    pub async fn send_on_path(
        &self,
        path: &Arc<RwLock<PathInterface>>,
        remote_addr: SocketAddr,
        data: &[u8],
    ) -> Result<usize, PathError> {
        let path_read = path.read();
        let socket = path_read
            .socket
            .as_ref()
            .ok_or_else(|| PathError::SocketNotBound(path_read.name.clone()))?;

        let n = socket
            .send_to(data, remote_addr)
            .await
            .map_err(|e| PathError::SendError(e.to_string()))?;

        drop(path_read);
        path.write().record_sent(n);

        Ok(n)
    }

    pub async fn receive_on_path(
        &self,
        path: &Arc<RwLock<PathInterface>>,
        buf: &mut [u8],
    ) -> Result<(usize, SocketAddr), PathError> {
        let path_read = path.read();
        let socket = path_read
            .socket
            .as_ref()
            .ok_or_else(|| PathError::SocketNotBound(path_read.name.clone()))?;

        let (n, addr) = socket
            .recv_from(buf)
            .await
            .map_err(|e| PathError::RecvError(e.to_string()))?;

        drop(path_read);
        path.write().record_received(n);

        Ok((n, addr))
    }

    pub fn get_path_stats(&self, name: &str) -> Option<PathState> {
        self.paths.get(name).map(|p| {
            let p = p.read();
            PathState {
                interface_name: p.name.clone(),
                local_addr: p.local_addr,
                active: p.active,
                bytes_sent: p.bytes_sent,
                bytes_received: p.bytes_received,
                last_heartbeat: p.last_heartbeat,
                heartbeat_interval: p.heartbeat_interval,
                rtt: p.rtt,
            }
        })
    }

    pub fn all_path_stats(&self) -> Vec<PathState> {
        self.paths
            .values()
            .map(|p| {
                let p = p.read();
                PathState {
                    interface_name: p.name.clone(),
                    local_addr: p.local_addr,
                    active: p.active,
                    bytes_sent: p.bytes_sent,
                    bytes_received: p.bytes_received,
                    last_heartbeat: p.last_heartbeat,
                    heartbeat_interval: p.heartbeat_interval,
                    rtt: p.rtt,
                }
            })
            .collect()
    }

    pub fn path_count(&self) -> usize {
        self.paths.len()
    }

    pub fn active_path_count(&self) -> usize {
        self.paths.values().filter(|p| p.read().is_available()).count()
    }

    pub fn healthy_path_count(&self) -> usize {
        self.paths.values().filter(|p| p.read().is_healthy()).count()
    }

    pub fn needs_any_heartbeat(&self) -> Vec<String> {
        self.paths
            .iter()
            .filter(|(_, p)| p.read().needs_heartbeat())
            .map(|(name, _)| name.clone())
            .collect()
    }

    pub fn needs_any_health_check(&self) -> Vec<String> {
        self.paths
            .iter()
            .filter(|(_, p)| p.read().needs_health_check())
            .map(|(name, _)| name.clone())
            .collect()
    }

    pub fn record_heartbeat_sent(&self, name: &str) {
        if let Some(path) = self.paths.get(name) {
            path.write().last_heartbeat = Some(Instant::now());
        }
    }

    pub fn record_heartbeat_response(&self, name: &str, rtt: Duration) {
        if let Some(path) = self.paths.get(name) {
            let mut p = path.write();
            p.record_rtt(rtt);
            p.consecutive_failures = 0;
            if p.health_status == PathHealthStatus::Failed {
                p.mark_as_healthy();
                drop(p);
                info!(path = %name, "Path recovered after heartbeat response");
            }
        }
    }

    pub fn record_heartbeat_timeout(&self, name: &str) {
        if let Some(path) = self.paths.get(name) {
            path.write().record_packet_loss();
        }
    }

    pub fn set_path_health_thresholds(
        &self,
        name: &str,
        max_rtt_ms: Option<u64>,
        max_loss_rate: Option<f64>,
    ) -> Result<(), PathError> {
        let path = self
            .paths
            .get(name)
            .ok_or_else(|| PathError::PathNotFound(name.to_string()))?;

        let mut p = path.write();
        if let Some(rtt) = max_rtt_ms {
            p.max_rtt_threshold = Duration::from_millis(rtt);
        }
        if let Some(loss) = max_loss_rate {
            p.max_packet_loss_rate = loss;
        }
        Ok(())
    }

    pub fn force_path_recovery(&self, name: &str) -> Result<(), PathError> {
        let path = self
            .paths
            .get(name)
            .ok_or_else(|| PathError::PathNotFound(name.to_string()))?;

        let mut p = path.write();
        p.mark_as_healthy();
        info!(path = %name, "Path forcefully recovered");
        Ok(())
    }

    pub fn force_path_failure(&self, name: &str) -> Result<(), PathError> {
        let path = self
            .paths
            .get(name)
            .ok_or_else(|| PathError::PathNotFound(name.to_string()))?;

        let mut p = path.write();
        p.mark_as_failed();
        drop(p);
        self.migrate_affected_flows(name);
        Ok(())
    }
}

impl Default for PathManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PathError {
    #[error("Path '{0}' already exists")]
    PathAlreadyExists(String),
    #[error("Path '{0}' not found")]
    PathNotFound(String),
    #[error("Failed to bind socket: {0}")]
    BindError(String),
    #[error("Socket not bound for path '{0}'")]
    SocketNotBound(String),
    #[error("Send error: {0}")]
    SendError(String),
    #[error("Receive error: {0}")]
    RecvError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_manager_creation() {
        let manager = PathManager::new();
        assert_eq!(manager.path_count(), 0);
        assert_eq!(manager.active_path_count(), 0);
    }

    #[test]
    fn test_add_path() {
        let mut manager = PathManager::new();
        let addr = "127.0.0.1:9000".parse().unwrap();

        assert!(manager.add_path("eth0".to_string(), addr).is_ok());
        assert_eq!(manager.path_count(), 1);
        assert_eq!(manager.active_path_count(), 1);
    }

    #[test]
    fn test_path_selection() {
        let mut manager = PathManager::new();
        let addr1: SocketAddr = "127.0.0.1:9000".parse().unwrap();
        let addr2: SocketAddr = "127.0.0.1:9001".parse().unwrap();

        manager.add_path("eth0".to_string(), addr1).unwrap();
        manager.add_path("eth1".to_string(), addr2).unwrap();

        let path = manager.select_path();
        assert!(path.is_some());
    }
}
