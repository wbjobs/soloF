use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use parking_lot::RwLock;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::types::*;

const TCP_BUFFER_SIZE: usize = 65536;
const BACKEND_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct BackendConnection {
    pub stream_id: StreamId,
    pub backend_addr: SocketAddr,
    pub connected: bool,
    pub last_activity: Option<Instant>,
    pub bytes_received: u64,
    pub bytes_sent: u64,
}

impl BackendConnection {
    pub fn new(stream_id: StreamId, backend_addr: SocketAddr) -> Self {
        Self {
            stream_id,
            backend_addr,
            connected: false,
            last_activity: None,
            bytes_received: 0,
            bytes_sent: 0,
        }
    }

    pub fn is_alive(&self, timeout: Duration) -> bool {
        self.last_activity
            .map(|t| t.elapsed() < timeout)
            .unwrap_or(false)
    }
}

pub struct StreamMapper {
    backend_connections: HashMap<StreamId, BackendConnection>,
    send_channels: HashMap<StreamId, mpsc::Sender<Bytes>>,
    recv_channel: mpsc::Sender<(StreamId, Bytes)>,
    connection_timeout: Duration,
}

impl StreamMapper {
    pub fn new(recv_channel: mpsc::Sender<(StreamId, Bytes)>) -> Self {
        Self {
            backend_connections: HashMap::new(),
            send_channels: HashMap::new(),
            recv_channel,
            connection_timeout: Duration::from_secs(60),
        }
    }

    pub fn add_stream_mapping(
        &mut self,
        stream_id: StreamId,
        backend_addr: SocketAddr,
    ) -> Result<(), MappingError> {
        if self.backend_connections.contains_key(&stream_id) {
            return Err(MappingError::StreamAlreadyMapped(stream_id));
        }

        let conn = BackendConnection::new(stream_id, backend_addr);
        self.backend_connections.insert(stream_id, conn);

        Ok(())
    }

    pub fn remove_stream_mapping(&mut self, stream_id: StreamId) -> Result<(), MappingError> {
        if self.backend_connections.remove(&stream_id).is_none() {
            return Err(MappingError::StreamNotFound(stream_id));
        }
        self.send_channels.remove(&stream_id);
        Ok(())
    }

    pub fn get_backend_addr(&self, stream_id: StreamId) -> Option<SocketAddr> {
        self.backend_connections
            .get(&stream_id)
            .map(|c| c.backend_addr)
    }

    pub fn get_stream_stats(&self, stream_id: StreamId) -> Option<StreamStats> {
        self.backend_connections.get(&stream_id).map(|c| StreamStats {
            stream_id: c.stream_id,
            backend_addr: c.backend_addr.to_string(),
            connected: c.connected,
            bytes_sent: c.bytes_sent,
            bytes_received: c.bytes_received,
            packets_sent: 0,
            packets_received: 0,
        })
    }

    pub fn all_stream_ids(&self) -> Vec<StreamId> {
        self.backend_connections.keys().copied().collect()
    }

    pub async fn connect_backend(&mut self, stream_id: StreamId) -> Result<(), MappingError> {
        let backend_addr = self
            .get_backend_addr(stream_id)
            .ok_or(MappingError::StreamNotFound(stream_id))?;

        info!(stream_id = %stream_id, backend = %backend_addr, "Connecting to backend");

        let stream = tokio::time::timeout(
            BACKEND_CONNECT_TIMEOUT,
            TcpStream::connect(backend_addr),
        )
        .await
        .map_err(|_| MappingError::ConnectTimeout(backend_addr))?
        .map_err(|e| MappingError::ConnectError(e.to_string()))?;

        stream
            .set_nodelay(true)
            .map_err(|e| MappingError::ConnectError(e.to_string()))?;

        let (mut reader, mut writer) = stream.into_split();

        let (send_tx, mut send_rx) = mpsc::channel::<Bytes>(1024);
        self.send_channels.insert(stream_id, send_tx);

        if let Some(conn) = self.backend_connections.get_mut(&stream_id) {
            conn.connected = true;
            conn.last_activity = Some(Instant::now());
        }

        let recv_channel = self.recv_channel.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; TCP_BUFFER_SIZE];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => {
                        debug!(stream_id = %stream_id, "Backend connection closed");
                        break;
                    }
                    Ok(n) => {
                        let data = Bytes::copy_from_slice(&buf[..n]);
                        if recv_channel.send((stream_id, data)).await.is_err() {
                            warn!(stream_id = %stream_id, "Failed to forward backend data");
                            break;
                        }
                    }
                    Err(e) => {
                        error!(stream_id = %stream_id, error = %e, "Backend read error");
                        break;
                    }
                }
            }
        });

        let stream_id_clone = stream_id;
        tokio::spawn(async move {
            while let Some(data) = send_rx.recv().await {
                match writer.write_all(&data).await {
                    Ok(()) => {}
                    Err(e) => {
                        error!(stream_id = %stream_id_clone, error = %e, "Backend write error");
                        break;
                    }
                }
            }
            let _ = writer.shutdown().await;
        });

        Ok(())
    }

    pub async fn disconnect_backend(&mut self, stream_id: StreamId) {
        self.send_channels.remove(&stream_id);
        if let Some(conn) = self.backend_connections.get_mut(&stream_id) {
            conn.connected = false;
        }
    }

    pub async fn route_to_backend(&self, stream_id: StreamId, data: Bytes) -> Result<(), MappingError> {
        let sender = self
            .send_channels
            .get(&stream_id)
            .ok_or(MappingError::StreamNotConnected(stream_id))?;

        sender
            .send(data)
            .await
            .map_err(|_| MappingError::SendFailed(stream_id))?;

        Ok(())
    }

    pub fn update_backend_stats(
        &mut self,
        stream_id: StreamId,
        bytes_sent: u64,
        bytes_received: u64,
    ) {
        if let Some(conn) = self.backend_connections.get_mut(&stream_id) {
            conn.bytes_sent += bytes_sent;
            conn.bytes_received += bytes_received;
            conn.last_activity = Some(Instant::now());
        }
    }

    pub fn cleanup_dead_connections(&mut self) {
        let timeout = self.connection_timeout;
        let dead_streams: Vec<StreamId> = self
            .backend_connections
            .iter()
            .filter(|(_, conn)| conn.connected && !conn.is_alive(timeout))
            .map(|(&id, _)| id)
            .collect();

        for stream_id in dead_streams {
            debug!(stream_id = %stream_id, "Removing dead backend connection");
            self.send_channels.remove(&stream_id);
            if let Some(conn) = self.backend_connections.get_mut(&stream_id) {
                conn.connected = false;
            }
        }
    }

    pub fn is_connected(&self, stream_id: StreamId) -> bool {
        self.backend_connections
            .get(&stream_id)
            .map(|c| c.connected)
            .unwrap_or(false)
    }

    pub fn connected_streams(&self) -> Vec<StreamId> {
        self.backend_connections
            .iter()
            .filter(|(_, c)| c.connected)
            .map(|(&id, _)| id)
            .collect()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MappingError {
    #[error("Stream {0} already mapped")]
    StreamAlreadyMapped(StreamId),
    #[error("Stream {0} not found")]
    StreamNotFound(StreamId),
    #[error("Stream {0} not connected to backend")]
    StreamNotConnected(StreamId),
    #[error("Connection to {0} timed out")]
    ConnectTimeout(SocketAddr),
    #[error("Connection error: {0}")]
    ConnectError(String),
    #[error("Failed to send data to stream {0}")]
    SendFailed(StreamId),
}
