use std::collections::{HashMap, BTreeMap};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use parking_lot::RwLock;
use tokio::sync::mpsc;

use super::protocol::*;
use crate::types::*;
use crate::mapping::StreamMapper;
use crate::multipath::PathManager;
use crate::qos::QoSManager;
use crate::stats::StatsCollector;

pub const DEFAULT_A_RWND: u32 = 1048576;
pub const DEFAULT_NUM_OUTBOUND_STREAMS: u16 = 1024;
pub const DEFAULT_NUM_INBOUND_STREAMS: u16 = 1024;
pub const RTO_INITIAL: Duration = Duration::from_millis(3000);
pub const RTO_MIN: Duration = Duration::from_millis(1000);
pub const RTO_MAX: Duration = Duration::from_millis(60000);
pub const RTO_ALPHA: f64 = 0.125;
pub const RTO_BETA: f64 = 0.25;

pub const MAX_REORDERING_WINDOW: u32 = 65536;
pub const REORDERING_TIMEOUT_MS: u64 = 200;
pub const FORWARD_TSN_THRESHOLD: u32 = 100;

#[derive(Debug, Clone)]
pub struct AssociationConfigParams {
    pub assoc_id: AssociationId,
    pub local_addr: SocketAddr,
    pub remote_addr: SocketAddr,
    pub init_tag: u32,
    pub a_rwnd: u32,
    pub num_outbound_streams: u16,
    pub num_inbound_streams: u16,
    pub initial_tsn: u32,
    pub stream_configs: Vec<StreamConfig>,
}

#[derive(Debug)]
pub struct TransmissionControlBlock {
    pub assoc_id: AssociationId,
    pub state: AssociationState,
    pub local_addr: SocketAddr,
    pub remote_addr: SocketAddr,
    pub local_verification_tag: u32,
    pub remote_verification_tag: u32,
    pub next_tsn: u32,
    pub last_acked_tsn: u32,
    pub a_rwnd: u32,
    pub cwnd: u32,
    pub ssthresh: u32,
    pub partial_bytes_acked: u32,
    pub rto: Duration,
    pub srtt: Duration,
    pub rttvar: Duration,
    pub num_outbound_streams: u16,
    pub num_inbound_streams: u16,
    pub stream_mapper: Arc<StreamMapper>,
    pub path_manager: Arc<PathManager>,
    pub qos_manager: Arc<QoSManager>,
    pub stats: Arc<StatsCollector>,
    pub send_queue: BTreeMap<u32, (Bytes, StreamId)>,
    pub sent_packets: HashMap<u32, SentPacketInfo>,
    pub recv_buffer: BTreeMap<u32, ReceivedPacketInfo>,
    pub expected_next_tsn: u32,
    pub cumulative_tsn_ack_point: u32,
    pub stream_seq_map: HashMap<StreamId, u16>,
    pub last_heartbeat_sent: Option<Instant>,
    pub last_heartbeat_received: Option<Instant>,
    pub heartbeat_interval: Duration,
    pub reordering_stats: ReorderingStats,
    pub stream_reorder_queue: HashMap<StreamId, StreamReorderQueue>,
    pub max_reordering_window: u32,
    pub reordering_timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct SentPacketInfo {
    pub tsn: u32,
    pub sent_at: Instant,
    pub data: Bytes,
    pub stream_id: StreamId,
    pub retrans_count: u8,
    pub fast_retrans: bool,
}

#[derive(Debug, Clone)]
pub struct ReceivedPacketInfo {
    pub tsn: u32,
    pub stream_id: StreamId,
    pub stream_seq: u16,
    pub payload_proto: u32,
    pub user_data: Bytes,
    pub received_at: Instant,
    pub in_order: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ReorderingStats {
    pub total_packets: u64,
    pub out_of_order_packets: u64,
    pub max_reorder_gap: u32,
    pub avg_reorder_gap: f64,
    pub reorder_events: u64,
    pub forward_tsn_count: u64,
    pub total_reorder_delay_micros: u64,
}

impl ReorderingStats {
    pub fn record_out_of_order(&mut self, gap: u32, delay_micros: u64) {
        self.out_of_order_packets += 1;
        self.max_reorder_gap = self.max_reorder_gap.max(gap);
        let total = self.out_of_order_packets as f64;
        self.avg_reorder_gap = (self.avg_reorder_gap * (total - 1.0) + gap as f64) / total;
        self.total_reorder_delay_micros += delay_micros;
        if self.out_of_order_packets == 1 {
            self.reorder_events += 1;
        }
    }

    pub fn record_in_order(&mut self) {
        self.total_packets += 1;
    }

    pub fn reorder_rate(&self) -> f64 {
        if self.total_packets == 0 {
            0.0
        } else {
            self.out_of_order_packets as f64 / self.total_packets as f64
        }
    }

    pub fn avg_reorder_delay_ms(&self) -> f64 {
        if self.out_of_order_packets == 0 {
            0.0
        } else {
            self.total_reorder_delay_micros as f64 / self.out_of_order_packets as f64 / 1000.0
        }
    }
}

#[derive(Debug, Clone)]
pub struct StreamReorderQueue {
    pub stream_id: StreamId,
    pub expected_seq: u16,
    pub buffer: BTreeMap<u16, (Bytes, Instant)>,
    pub max_buffer_size: usize,
    pub last_forward_time: Instant,
    pub reorder_count: u64,
}

impl TransmissionControlBlock {
    pub fn new(
        config: AssociationConfigParams,
        stream_mapper: Arc<StreamMapper>,
        path_manager: Arc<PathManager>,
        qos_manager: Arc<QoSManager>,
        stats: Arc<StatsCollector>,
    ) -> Self {
        let mut stream_reorder_queue = HashMap::new();
        for stream_config in &config.stream_configs {
            stream_reorder_queue.insert(
                stream_config.stream_id,
                StreamReorderQueue {
                    stream_id: stream_config.stream_id,
                    expected_seq: 0,
                    buffer: BTreeMap::new(),
                    max_buffer_size: 1024,
                    last_forward_time: Instant::now(),
                    reorder_count: 0,
                },
            );
        }

        Self {
            assoc_id: config.assoc_id,
            state: AssociationState::Closed,
            local_addr: config.local_addr,
            remote_addr: config.remote_addr,
            local_verification_tag: generate_verification_tag(),
            remote_verification_tag: config.init_tag,
            next_tsn: config.initial_tsn,
            last_acked_tsn: config.initial_tsn.wrapping_sub(1),
            a_rwnd: config.a_rwnd,
            cwnd: 4352,
            ssthresh: config.a_rwnd,
            partial_bytes_acked: 0,
            rto: RTO_INITIAL,
            srtt: Duration::from_millis(0),
            rttvar: Duration::from_millis(0),
            num_outbound_streams: config.num_outbound_streams,
            num_inbound_streams: config.num_inbound_streams,
            stream_mapper,
            path_manager,
            qos_manager,
            stats,
            send_queue: BTreeMap::new(),
            sent_packets: HashMap::new(),
            recv_buffer: BTreeMap::new(),
            expected_next_tsn: 0,
            cumulative_tsn_ack_point: 0,
            stream_seq_map: HashMap::new(),
            last_heartbeat_sent: None,
            last_heartbeat_received: None,
            heartbeat_interval: Duration::from_secs(30),
            reordering_stats: ReorderingStats::default(),
            stream_reorder_queue,
            max_reordering_window: MAX_REORDERING_WINDOW,
            reordering_timeout: Duration::from_millis(REORDERING_TIMEOUT_MS),
        }
    }

    pub fn next_tsn(&mut self) -> u32 {
        let tsn = self.next_tsn;
        self.next_tsn = self.next_tsn.wrapping_add(1);
        tsn
    }

    pub fn next_stream_seq(&mut self, stream_id: StreamId) -> u16 {
        let seq = self
            .stream_seq_map
            .get(&stream_id)
            .copied()
            .unwrap_or(0);
        self.stream_seq_map.insert(stream_id, seq.wrapping_add(1));
        seq
    }

    pub fn update_rtt(&mut self, rtt: Duration) {
        if self.srtt.as_micros() == 0 {
            self.srtt = rtt;
            self.rttvar = Duration::from_micros((rtt.as_micros() as f64 / 2.0) as u64);
        } else {
            let error = if rtt > self.srtt {
                (rtt.as_micros() as i64 - self.srtt.as_micros() as i64).unsigned_abs()
            } else {
                (self.srtt.as_micros() as i64 - rtt.as_micros() as i64).unsigned_abs()
            };
            self.rttvar = Duration::from_micros(
                ((1.0 - RTO_BETA) * self.rttvar.as_micros() as f64
                    + RTO_BETA * error as f64) as u64,
            );
            self.srtt = Duration::from_micros(
                ((1.0 - RTO_ALPHA) * self.srtt.as_micros() as f64
                    + RTO_ALPHA * rtt.as_micros() as f64) as u64,
            );
        }

        let rto_calc = self.srtt.as_micros() as f64 + 4.0 * self.rttvar.as_micros() as f64;
        self.rto = Duration::from_micros(
            rto_calc.max(RTO_MIN.as_micros() as f64) as u64
        ).min(RTO_MAX);
    }

    pub fn handle_congestion_control(&mut self, acked_bytes: u32) {
        if self.cwnd <= self.ssthresh {
            self.cwnd += acked_bytes.min(self.path_manager.mtu());
        } else {
            self.partial_bytes_acked += acked_bytes;
            if self.partial_bytes_acked >= self.cwnd {
                self.cwnd += self.path_manager.mtu();
                self.partial_bytes_acked -= self.cwnd;
            }
        }
        self.cwnd = self.cwnd.min(self.a_rwnd);
    }

    pub fn handle_sack(&mut self, sack: &SackChunkPayload) {
        let now = Instant::now();

        self.a_rwnd = sack.a_rwnd;
        self.cumulative_tsn_ack_point = sack.cumulative_tsn_ack;

        for &(gap_start, gap_end) in &sack.gap_ack_blocks {
            let start_tsn = sack.cumulative_tsn_ack.wrapping_add(gap_start as u32);
            let end_tsn = sack.cumulative_tsn_ack.wrapping_add(gap_end as u32);

            for tsn in start_tsn..=end_tsn {
                if let Some(pkt) = self.sent_packets.remove(&tsn) {
                    let rtt = now.duration_since(pkt.sent_at);
                    self.update_rtt(rtt);
                    self.handle_congestion_control(pkt.data.len() as u32);
                    self.stats.record_send_ack(pkt.tsn, pkt.stream_id);
                }
            }
        }

        for tsn in &sack.dup_tsns {
            if let Some(pkt) = self.sent_packets.get_mut(tsn) {
                pkt.fast_retrans = true;
            }
        }
    }

    pub fn queue_data(&mut self, stream_id: StreamId, data: Bytes, payload_proto: u32) -> u32 {
        let tsn = self.next_tsn();
        let stream_seq = self.next_stream_seq(stream_id);
        let payload = DataChunkPayload {
            tsn,
            stream_id,
            stream_seq,
            payload_proto,
            user_data: data.clone(),
        };

        let flags = ChunkFlags::new();
        let chunk = payload.encode(flags);
        let chunk_data = {
            let mut buf = bytes::BytesMut::new();
            chunk.encode(&mut buf);
            buf.freeze()
        };

        self.send_queue.insert(tsn, (chunk_data, stream_id));
        self.stats.record_send_request(stream_id, data.len() as u64);

        tsn
    }

    pub fn get_sendable_data(&mut self, max_size: usize) -> Vec<(u32, Bytes)> {
        let mut sendable = Vec::new();
        let mut current_size = 0;
        let cwnd = self.cwnd.min(self.a_rwnd);

        let tsns: Vec<u32> = self.send_queue.keys().copied().collect();
        for tsn in tsns {
            if let Some((data, stream_id)) = self.send_queue.get(&tsn) {
                if current_size + data.len() > cwnd as usize {
                    break;
                }
                if current_size + data.len() > max_size {
                    break;
                }

                let data = data.clone();
                let stream_id = *stream_id;
                self.send_queue.remove(&tsn);
                self.sent_packets.insert(
                    tsn,
                    SentPacketInfo {
                        tsn,
                        sent_at: Instant::now(),
                        data: data.clone(),
                        stream_id,
                        retrans_count: 0,
                        fast_retrans: false,
                    },
                );
                sendable.push((tsn, data));
                current_size += data.len();
            }
        }

        sendable
    }

    pub fn check_retransmissions(&mut self) -> Vec<(u32, Bytes)> {
        let now = Instant::now();
        let mut retrans = Vec::new();

        let tsns: Vec<u32> = self.sent_packets.keys().copied().collect();
        for tsn in tsns {
            let should_retrans = {
                if let Some(pkt) = self.sent_packets.get(&tsn) {
                    let elapsed = now.duration_since(pkt.sent_at);
                    pkt.fast_retrans
                        || (elapsed >= self.rto && pkt.retrans_count < 10)
                } else {
                    false
                }
            };

            if should_retrans {
                if let Some(pkt) = self.sent_packets.remove(&tsn) {
                    if pkt.retrans_count < 10 {
                        retrans.push((tsn, pkt.data.clone()));
                        self.sent_packets.insert(
                            tsn,
                            SentPacketInfo {
                                tsn,
                                sent_at: now,
                                data: pkt.data,
                                stream_id: pkt.stream_id,
                                retrans_count: pkt.retrans_count + 1,
                                fast_retrans: false,
                            },
                        );
                    }
                }
            }
        }

        if !retrans.is_empty() {
            self.ssthresh = (self.cwnd / 2).max(4 * self.path_manager.mtu());
            self.cwnd = self.ssthresh;
        }

        retrans
    }

    pub fn handle_data(&mut self, payload: DataChunkPayload) {
        let now = Instant::now();
        let tsn = payload.tsn;
        let stream_id = payload.stream_id;

        let tsn_diff = tsn.wrapping_sub(self.expected_next_tsn);
        let in_order = tsn == self.expected_next_tsn;

        let packet_info = ReceivedPacketInfo {
            tsn,
            stream_id,
            stream_seq: payload.stream_seq,
            payload_proto: payload.payload_proto,
            user_data: payload.user_data.clone(),
            received_at: now,
            in_order,
        };

        self.recv_buffer.insert(tsn, packet_info);

        if in_order {
            self.reordering_stats.record_in_order();
            self.process_ordered_packets();
        } else {
            let gap = tsn_diff;
            let delay_micros = 0;
            self.reordering_stats.record_out_of_order(gap, delay_micros);
            tracing::debug!(
                "Out-of-order packet: TSN={}, expected={}, gap={}",
                tsn,
                self.expected_next_tsn,
                gap
            );

            if gap > self.max_reordering_window {
                self.forward_tsn(tsn);
            }
        }

        let _ = self.process_stream_reordering(stream_id);
    }

    fn process_ordered_packets(&mut self) {
        let assoc_id = self.assoc_id;
        while let Some(packet) = self.recv_buffer.remove(&self.expected_next_tsn) {
            let stream_id = packet.stream_id;
            let data = packet.user_data.clone();

            if let Some(queue) = self.stream_reorder_queue.get_mut(&stream_id) {
                queue.buffer.insert(
                    packet.stream_seq,
                    (data, packet.received_at),
                );
                self.process_stream_ready_data(stream_id);
            } else {
                let mut queue = StreamReorderQueue {
                    stream_id,
                    expected_seq: 0,
                    buffer: BTreeMap::new(),
                    max_buffer_size: 1024,
                    last_forward_time: Instant::now(),
                    reorder_count: 0,
                };
                queue.buffer.insert(packet.stream_seq, (data, packet.received_at));
                self.stream_reorder_queue.insert(stream_id, queue);
                self.process_stream_ready_data(stream_id);
            }

            self.stats.record_recv(assoc_id, stream_id, data.len() as u64);
            self.expected_next_tsn = self.expected_next_tsn.wrapping_add(1);
        }
    }

    fn process_stream_ready_data(&mut self, stream_id: StreamId) {
        let Some(queue) = self.stream_reorder_queue.get_mut(&stream_id) else {
            return;
        };

        let mut to_deliver = Vec::new();
        while let Some((seq, (data, _received_at))) = queue.buffer.pop_first() {
            if seq == queue.expected_seq {
                to_deliver.push(data);
                queue.expected_seq = queue.expected_seq.wrapping_add(1);
            } else if seq.wrapping_sub(queue.expected_seq) < 32768 {
                queue.buffer.insert(seq, (data, _received_at));
                break;
            } else {
                to_deliver.push(data);
                queue.expected_seq = seq.wrapping_add(1);
                queue.reorder_count += 1;
            }
        }

        drop(queue);

        for data in to_deliver {
            let _ = self.stream_mapper.route_to_backend(stream_id, data);
        }
    }

    fn forward_tsn(&mut self, new_cumulative_tsn: u32) {
        tracing::debug!(
            "Forwarding TSN from {} to {} due to reordering window overflow",
            self.expected_next_tsn,
            new_cumulative_tsn
        );

        while self.expected_next_tsn != new_cumulative_tsn {
            self.recv_buffer.remove(&self.expected_next_tsn);
            self.expected_next_tsn = self.expected_next_tsn.wrapping_add(1);
        }

        self.reordering_stats.forward_tsn_count += 1;
    }

    pub fn process_stream_reordering(&mut self, stream_id: StreamId) -> usize {
        let Some(queue) = self.stream_reorder_queue.get_mut(&stream_id) else {
            return 0;
        };

        let now = Instant::now();
        let mut delivered = 0;

        if now.duration_since(queue.last_forward_time) > self.reordering_timeout
            && !queue.buffer.is_empty()
        {
            if let Some((&first_seq, _)) = queue.buffer.first_key_value() {
                if first_seq != queue.expected_seq {
                    queue.expected_seq = first_seq;
                    queue.reorder_count += 1;
                }
            }

            let mut to_deliver = Vec::new();
            while let Some((seq, (data, _))) = queue.buffer.pop_first() {
                if seq == queue.expected_seq {
                    to_deliver.push(data);
                    queue.expected_seq = queue.expected_seq.wrapping_add(1);
                    delivered += 1;
                } else {
                    break;
                }
            }

            drop(queue);

            for data in to_deliver {
                let _ = self.stream_mapper.route_to_backend(stream_id, data);
            }

            if delivered > 0 {
                if let Some(q) = self.stream_reorder_queue.get_mut(&stream_id) {
                    q.last_forward_time = now;
                }
            }
        }

        delivered
    }

    pub fn check_reordering_timeouts(&mut self) {
        let stream_ids: Vec<StreamId> = self.stream_reorder_queue.keys().copied().collect();
        for stream_id in stream_ids {
            self.process_stream_reordering(stream_id);
        }
    }

    pub fn get_reordering_stats(&self) -> ReorderingStats {
        self.reordering_stats.clone()
    }

    pub fn build_sack(&self) -> SackChunkPayload {
        let mut gap_blocks = Vec::new();
        let mut dup_tsns = Vec::new();

        let mut sorted_tsns: Vec<u32> = self.recv_buffer.keys().copied().collect();
        sorted_tsns.sort();

        let mut prev_tsn = self.cumulative_tsn_ack_point;
        for &tsn in &sorted_tsns {
            if tsn <= self.cumulative_tsn_ack_point {
                dup_tsns.push(tsn);
            } else if tsn.wrapping_sub(prev_tsn) > 1 {
                gap_blocks.push((
                    prev_tsn.wrapping_sub(self.cumulative_tsn_ack_point) as u16 + 1,
                    tsn.wrapping_sub(self.cumulative_tsn_ack_point) as u16,
                ));
                prev_tsn = tsn;
            } else {
                prev_tsn = tsn;
            }
        }

        SackChunkPayload {
            cumulative_tsn_ack: self.cumulative_tsn_ack_point,
            a_rwnd: self.a_rwnd,
            num_gap_ack_blocks: gap_blocks.len() as u16,
            num_dup_tsns: dup_tsns.len() as u16,
            gap_ack_blocks: gap_blocks,
            dup_tsns,
        }
    }

    pub fn build_heartbeat(&self) -> SctpChunk {
        let mut buf = bytes::BytesMut::new();
        let timestamp = Instant::now();
        let unix_nanos = timestamp
            .duration_since(std::time::UNIX_EPOCH)
            .as_nanos() as u64;
        buf.put_u64(unix_nanos);
        SctpChunk::new(ChunkType::Heartbeat, ChunkFlags::new(), buf.freeze())
    }

    pub fn needs_heartbeat(&self) -> bool {
        self.last_heartbeat_sent
            .map(|t| t.elapsed() >= self.heartbeat_interval)
            .unwrap_or(true)
    }

    pub fn record_heartbeat_sent(&mut self) {
        self.last_heartbeat_sent = Some(Instant::now());
    }

    pub fn record_heartbeat_received(&mut self) {
        self.last_heartbeat_received = Some(Instant::now());
    }
}

pub struct AssociationManager {
    associations: HashMap<AssociationId, Arc<RwLock<TransmissionControlBlock>>>,
    stream_mapper: Arc<StreamMapper>,
    path_manager: Arc<PathManager>,
    qos_manager: Arc<QoSManager>,
    stats: Arc<StatsCollector>,
}

impl AssociationManager {
    pub fn new(
        stream_mapper: Arc<StreamMapper>,
        path_manager: Arc<PathManager>,
        qos_manager: Arc<QoSManager>,
        stats: Arc<StatsCollector>,
    ) -> Self {
        Self {
            associations: HashMap::new(),
            stream_mapper,
            path_manager,
            qos_manager,
            stats,
        }
    }

    pub fn create_association(
        &mut self,
        config: AssociationConfigParams,
    ) -> Arc<RwLock<TransmissionControlBlock>> {
        let tcb = TransmissionControlBlock::new(
            config,
            self.stream_mapper.clone(),
            self.path_manager.clone(),
            self.qos_manager.clone(),
            self.stats.clone(),
        );
        let tcb = Arc::new(RwLock::new(tcb));
        self.associations.insert(tcb.read().assoc_id, tcb.clone());
        tcb
    }

    pub fn remove_association(&mut self, assoc_id: AssociationId) {
        self.associations.remove(&assoc_id);
    }

    pub fn get_association(
        &self,
        assoc_id: AssociationId,
    ) -> Option<Arc<RwLock<TransmissionControlBlock>>> {
        self.associations.get(&assoc_id).cloned()
    }

    pub fn all_associations(&self) -> Vec<AssociationId> {
        self.associations.keys().copied().collect()
    }

    pub fn get_stats(&self, assoc_id: AssociationId) -> Option<AssociationStats> {
        self.associations.get(&assoc_id).map(|tcb| {
            let tcb = tcb.read();
            self.stats.get_association_stats(assoc_id, tcb.state)
        })
    }
}
