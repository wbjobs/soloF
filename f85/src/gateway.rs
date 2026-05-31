use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::{Bytes, BytesMut};
use parking_lot::RwLock;
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::config::CliArgs;
use crate::mapping::stream_mapper::StreamMapper;
use crate::multipath::path_manager::PathManager;
use crate::qos::queue::QoSManager;
use crate::sctp::association::{AssociationConfigParams, AssociationManager};
use crate::sctp::protocol::*;
use crate::stats::collector::StatsCollector;
use crate::types::*;

pub struct SctpGateway {
    args: CliArgs,
    association_manager: Arc<RwLock<AssociationManager>>,
    stream_mapper: Arc<RwLock<StreamMapper>>,
    path_manager: Arc<RwLock<PathManager>>,
    qos_manager: Arc<RwLock<QoSManager>>,
    stats: Arc<StatsCollector>,
    socket: Option<Arc<UdpSocket>>,
}

impl SctpGateway {
    pub fn new(args: CliArgs) -> Self {
        let (backend_tx, backend_rx) = mpsc::channel::<(StreamId, Bytes)>(1024);

        let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(backend_tx.clone())));
        let path_manager = Arc::new(RwLock::new(PathManager::new()));
        let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
        let stats = Arc::new(StatsCollector::new());

        let association_manager = Arc::new(RwLock::new(AssociationManager::new(
            stream_mapper.clone(),
            path_manager.clone(),
            qos_manager.clone(),
            stats.clone(),
        )));

        Self {
            args,
            association_manager,
            stream_mapper,
            path_manager,
            qos_manager,
            stats,
            socket: None,
        }
    }

    pub fn api_state(&self) -> crate::api::server::ApiState {
        crate::api::server::ApiState {
            association_manager: self.association_manager.clone(),
            stream_mapper: self.stream_mapper.clone(),
            path_manager: self.path_manager.clone(),
            qos_manager: self.qos_manager.clone(),
            stats: self.stats.clone(),
        }
    }

    pub async fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let interfaces = self.args.parse_interfaces();

        if !interfaces.is_empty() {
            let mut path_mgr = self.path_manager.write();
            for interface in &interfaces {
                let addr: SocketAddr = format!("{}:0", interface)
                    .parse()
                    .unwrap_or_else(|_| "0.0.0.0:0".parse().unwrap());
                match path_mgr.add_path(interface.clone(), addr) {
                    Ok(()) => {
                        info!(path = %interface, "Added network path");
                    }
                    Err(e) => {
                        warn!(path = %interface, error = %e, "Failed to add path");
                    }
                }
            }
        } else {
            let mut path_mgr = self.path_manager.write();
            let addr: SocketAddr = "0.0.0.0:0".parse().unwrap();
            path_mgr
                .add_path("default".to_string(), addr)
                .expect("Failed to add default path");
        }

        Ok(())
    }

    pub async fn run(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let listen_addr: SocketAddr = self.args.sctp_listen_addr.parse()?;

        let socket = UdpSocket::bind(listen_addr).await?;
        info!(addr = %listen_addr, "SCTP gateway listening");
        self.socket = Some(Arc::new(socket));

        let socket = self.socket.clone().unwrap();

        let (data_tx, mut data_rx) = mpsc::channel::<(SocketAddr, Bytes)>(1024);
        let (sack_tx, mut sack_rx) = mpsc::channel::<(SocketAddr, SackChunkPayload)>(1024);

        let association_manager = self.association_manager.clone();
        let stream_mapper = self.stream_mapper.clone();
        let path_manager = self.path_manager.clone();
        let qos_manager = self.qos_manager.clone();
        let stats = self.stats.clone();

        let recv_socket = socket.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 65536];
            loop {
                match recv_socket.recv_from(&mut buf).await {
                    Ok((n, addr)) => {
                        let data = Bytes::copy_from_slice(&buf[..n]);
                        if let Err(e) =
                            handle_incoming_packet(addr, data, association_manager.clone()).await
                        {
                            warn!(error = %e, "Failed to handle incoming packet");
                        }
                    }
                    Err(e) => {
                        error!(error = %e, "Socket receive error");
                        break;
                    }
                }
            }
        });

        let path_manager_clone = self.path_manager.clone();
        let send_socket = socket.clone();
        tokio::spawn(async move {
            loop {
                let packet_to_send = {
                    let paths = path_manager_clone.read();
                    paths.select_path()
                };

                if let Some(path) = packet_to_send {
                    let addr = "127.0.0.1:9000".parse().unwrap();
                    let data = Bytes::from_static(b"");
                    let path_clone = path.clone();
                    let pm = path_manager_clone.clone();
                    let socket_clone = send_socket.clone();
                    tokio::spawn(async move {
                        let _ = pm
                            .read()
                            .send_on_path(&path_clone, addr, &data)
                            .await;
                    });
                }

                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        });

        let qos_manager = self.qos_manager.clone();
        let stream_mapper = self.stream_mapper.clone();
        let stats = self.stats.clone();
        tokio::spawn(async move {
            loop {
                let items = qos_manager.read().dequeue_all_available();
                for (stream_id, data) in items {
                    let mapper = stream_mapper.read();
                    if mapper.is_connected(stream_id) {
                        match mapper.route_to_backend(stream_id, data).await {
                            Ok(()) => {}
                            Err(e) => {
                                warn!(stream_id = %stream_id, error = %e, "Failed to route to backend");
                            }
                        }
                    } else {
                        debug!(stream_id = %stream_id, "Stream not connected, dropping data");
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        });

        let stream_mapper = self.stream_mapper.clone();
        tokio::spawn(async move {
            loop {
                stream_mapper.write().cleanup_dead_connections();
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });

        let association_manager = self.association_manager.clone();
        let path_manager = self.path_manager.clone();
        let stats = self.stats.clone();
        let socket = socket.clone();
        tokio::spawn(async move {
            loop {
                let assoc_ids = association_manager.read().all_associations();
                for assoc_id in assoc_ids {
                    if let Some(tcb) = association_manager.read().get_association(assoc_id) {
                        let mut tcb = tcb.write();

                        tcb.check_reordering_timeouts();

                        let sendable = tcb.get_sendable_data(65536);
                        for (tsn, data) in sendable {
                            let remote_addr = tcb.remote_addr;
                            let stream_id = tcb.sent_packets
                                .get(&tsn)
                                .map(|p| p.stream_id)
                                .unwrap_or(0);

                            let path = path_manager
                                .read()
                                .select_path_for_flow(assoc_id, stream_id);

                            if let Some(path) = path {
                                let path_clone = path.clone();
                                let pm = path_manager.clone();
                                let data_clone = data.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = pm
                                        .read()
                                        .send_on_path(&path_clone, remote_addr, &data_clone)
                                        .await
                                    {
                                        warn!(error = %e, "Data send failed");
                                    }
                                });
                            }
                        }

                        let retrans = tcb.check_retransmissions();
                        for (tsn, data) in retrans {
                            let remote_addr = tcb.remote_addr;
                            let stream_id = tcb.sent_packets
                                .get(&tsn)
                                .map(|p| p.stream_id)
                                .unwrap_or(0);

                            let path = path_manager
                                .read()
                                .select_path_for_flow(assoc_id, stream_id);

                            if let Some(path) = path {
                                let path_clone = path.clone();
                                let pm = path_manager.clone();
                                let data_clone = data.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = pm
                                        .read()
                                        .send_on_path(&path_clone, remote_addr, &data_clone)
                                        .await
                                    {
                                        warn!(error = %e, "Retransmission failed");
                                    }
                                });
                            }
                        }

                        let sack = tcb.build_sack();
                        if sack.num_gap_ack_blocks > 0 || sack.num_dup_tsns > 0 {
                            let remote_addr = tcb.remote_addr;
                            let chunk = sack.encode();
                            let mut buf = BytesMut::new();
                            SctpHeader::new(0, 0, tcb.remote_verification_tag).encode(&mut buf);
                            chunk.encode(&mut buf);
                            let data = buf.freeze();

                            let path = path_manager.read().select_path();
                            if let Some(path) = path {
                                let path_clone = path.clone();
                                let pm = path_manager.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = pm
                                        .read()
                                        .send_on_path(&path_clone, remote_addr, &data)
                                        .await
                                    {
                                        warn!(error = %e, "SACK send failed");
                                    }
                                });
                            }
                        }

                        if tcb.needs_heartbeat() {
                            let remote_addr = tcb.remote_addr;
                            let chunk = tcb.build_heartbeat();
                            let mut buf = BytesMut::new();
                            SctpHeader::new(0, 0, tcb.remote_verification_tag).encode(&mut buf);
                            chunk.encode(&mut buf);
                            let data = buf.freeze();

                            tcb.record_heartbeat_sent();

                            let path = path_manager.read().select_path();
                            if let Some(path) = path {
                                let path_clone = path.clone();
                                let pm = path_manager.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = pm
                                        .read()
                                        .send_on_path(&path_clone, remote_addr, &data)
                                        .await
                                    {
                                        warn!(error = %e, "Heartbeat send failed");
                                    }
                                });
                            }
                        }
                    }
                }

                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });

        let path_manager = self.path_manager.clone();
        tokio::spawn(async move {
            loop {
                {
                    let pm = path_manager.read();
                    let health_results = pm.check_all_health();

                    for (name, status) in &health_results {
                        match status {
                            crate::multipath::path_manager::PathHealthStatus::Failed => {
                                warn!(path = %name, "Path health check: FAILED");
                            }
                            crate::multipath::path_manager::PathHealthStatus::Unhealthy => {
                                warn!(path = %name, "Path health check: UNHEALTHY");
                            }
                            crate::multipath::path_manager::PathHealthStatus::Degraded => {
                                debug!(path = %name, "Path health check: DEGRADED");
                            }
                            crate::multipath::path_manager::PathHealthStatus::Healthy => {}
                        }
                    }
                }

                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });

        let path_manager = self.path_manager.clone();
        tokio::spawn(async move {
            loop {
                {
                    let pm = path_manager.read();
                    let paths_to_check = pm.needs_any_health_check();

                    for path_name in paths_to_check {
                        if let Some(path) = pm.paths.get(&path_name) {
                            let mut p = path.write();
                            if p.socket.is_some() {
                                p.last_health_check = Some(Instant::now());
                                drop(p);

                                let path_clone = path.clone();
                                let pm_clone = path_manager.clone();
                                let name = path_name.clone();
                                tokio::spawn(async move {
                                    let p = path_clone.read();
                                    if let Some(socket) = &p.socket {
                                        let probe_data = b"PATH_PROBE";
                                        let remote_addr = "0.0.0.0:0".parse().unwrap();

                                        let send_time = Instant::now();
                                        match socket.send_to(probe_data, remote_addr).await {
                                            Ok(_) => {
                                                let rtt = send_time.elapsed();
                                                if rtt < Duration::from_secs(3) {
                                                    pm_clone.read().record_heartbeat_response(&name, rtt);
                                                } else {
                                                    pm_clone.read().record_heartbeat_timeout(&name);
                                                }
                                            }
                                            Err(_) => {
                                                pm_clone.read().record_heartbeat_timeout(&name);
                                            }
                                        }
                                    }
                                });
                            }
                        }
                    }
                }

                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });

        let (backend_tx, mut backend_rx) = mpsc::channel::<(StreamId, Bytes)>(1024);
        let association_manager = self.association_manager.clone();
        let stats = self.stats.clone();
        tokio::spawn(async move {
            while let Some((stream_id, data)) = backend_rx.recv().await {
                let assoc_ids = association_manager.read().all_associations();
                for assoc_id in assoc_ids {
                    if let Some(tcb) = association_manager.read().get_association(assoc_id) {
                        let mut tcb = tcb.write();
                        if tcb.state == AssociationState::Established {
                            let tsn = tcb.queue_data(stream_id, data.clone(), 0);
                            stats.record_send(assoc_id, stream_id, data.len() as u64);
                        }
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn send_data(
        &self,
        assoc_id: AssociationId,
        stream_id: StreamId,
        data: Bytes,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let manager = self.association_manager.read();
        if let Some(tcb) = manager.get_association(assoc_id) {
            let mut tcb = tcb.write();
            if tcb.state == AssociationState::Established {
                tcb.queue_data(stream_id, data, 0);
                self.stats.record_send(assoc_id, stream_id, data.len() as u64);
            }
        }
        Ok(())
    }

    pub fn stats(&self) -> &Arc<StatsCollector> {
        &self.stats
    }

    pub fn path_manager(&self) -> &Arc<RwLock<PathManager>> {
        &self.path_manager
    }
}

async fn handle_incoming_packet(
    addr: SocketAddr,
    data: Bytes,
    association_manager: Arc<RwLock<AssociationManager>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut buf = data.as_ref();
    let packet = SctpPacket::parse(&mut buf)?;

    debug!(
        from = %addr,
        num_chunks = packet.chunks.len(),
        "Received SCTP packet"
    );

    for chunk in &packet.chunks {
        match chunk.chunk_type {
            ChunkType::Data | ChunkType::IData => {
                if let Ok(payload) = DataChunkPayload::parse(chunk) {
                    let assoc_ids = association_manager.read().all_associations();
                    for assoc_id in assoc_ids {
                        if let Some(tcb) = association_manager.read().get_association(assoc_id) {
                            let mut tcb = tcb.write();
                            tcb.handle_data(payload.clone());
                        }
                    }
                }
            }
            ChunkType::Sack => {
                if let Ok(sack) = SackChunkPayload::parse(chunk) {
                    let assoc_ids = association_manager.read().all_associations();
                    for assoc_id in assoc_ids {
                        if let Some(tcb) = association_manager.read().get_association(assoc_id) {
                            let mut tcb = tcb.write();
                            tcb.handle_sack(&sack);
                        }
                    }
                }
            }
            ChunkType::Init => {
                info!(from = %addr, "Received INIT chunk");
            }
            ChunkType::InitAck => {
                info!(from = %addr, "Received INIT-ACK chunk");
            }
            ChunkType::Heartbeat => {
                debug!(from = %addr, "Received HEARTBEAT chunk");
            }
            ChunkType::HeartbeatAck => {
                debug!(from = %addr, "Received HEARTBEAT-ACK chunk");
            }
            ChunkType::CookieEcho => {
                info!(from = %addr, "Received COOKIE-ECHO chunk");
            }
            ChunkType::CookieAck => {
                info!(from = %addr, "Received COOKIE-ACK chunk");
            }
            _ => {
                debug!(chunk_type = ?chunk.chunk_type, "Received unhandled chunk type");
            }
        }
    }

    Ok(())
}

async fn handle_backend_data(
    stream_id: StreamId,
    data: Bytes,
    qos_manager: Arc<RwLock<QoSManager>>,
    stats: Arc<StatsCollector>,
) {
    if let Err(e) = qos_manager.read().enqueue(stream_id, data.clone()) {
        warn!(stream_id = %stream_id, error = %e, "Failed to enqueue backend data");
        return;
    }

    debug!(stream_id = %stream_id, len = data.len(), "Queued backend data");
}
