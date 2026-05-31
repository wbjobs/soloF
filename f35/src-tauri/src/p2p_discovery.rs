use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

const BROADCAST_ADDR: &str = "255.255.255.255:45678";
const LISTEN_ADDR: &str = "0.0.0.0:45678";
const ANNOUNCE_INTERVAL: u64 = 5;
const PEER_TIMEOUT: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub last_seen: u64,
}

#[derive(Debug, Serialize, Deserialize)]
enum DiscoveryMessage {
    Announce {
        id: String,
        name: String,
        timestamp: u64,
    },
    Discovery {
        id: String,
        timestamp: u64,
    },
}

pub struct P2PDiscovery {
    node_id: String,
    node_name: String,
    peers: Arc<Mutex<HashMap<String, Peer>>>,
    running: Arc<Mutex<bool>>,
    socket: Arc<Mutex<Option<UdpSocket>>>,
}

impl P2PDiscovery {
    pub async fn new() -> Self {
        let node_id = Uuid::new_v4().to_string();
        let hostname = gethostname::gethostname();
        let node_name = hostname.to_string_lossy().to_string();

        Self {
            node_id,
            node_name,
            peers: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
            socket: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        *self.running.lock().await = true;

        let socket = UdpSocket::bind(LISTEN_ADDR)?;
        socket.set_broadcast(true)?;
        socket.set_nonblocking(true)?;

        let socket_arc = Arc::new(Mutex::new(Some(socket)));
        *self.socket.lock().await = Some(socket_arc.lock().await.take().unwrap());

        let running = self.running.clone();
        let peers = self.peers.clone();
        let node_id = self.node_id.clone();
        let node_name = self.node_name.clone();

        tokio::spawn(async move {
            let socket = UdpSocket::bind(LISTEN_ADDR).unwrap();
            socket.set_broadcast(true).unwrap();

            while *running.lock().await {
                let mut buf = [0; 1024];
                match socket.recv_from(&mut buf) {
                    Ok((len, src)) => {
                        if let Ok(msg) = serde_json::from_slice::<DiscoveryMessage>(&buf[..len]) {
                            match msg {
                                DiscoveryMessage::Announce {
                                    id,
                                    name,
                                    timestamp,
                                } => {
                                    if id != node_id {
                                        let mut peers_lock = peers.lock().await;
                                        peers_lock.insert(
                                            id.clone(),
                                            Peer {
                                                id,
                                                name,
                                                address: src.to_string(),
                                                last_seen: timestamp,
                                            },
                                        );
                                    }
                                }
                                DiscoveryMessage::Discovery { id, timestamp } => {
                                    if id != node_id {
                                        let response = DiscoveryMessage::Announce {
                                            id: node_id.clone(),
                                            name: node_name.clone(),
                                            timestamp: get_timestamp(),
                                        };
                                        let _ = socket.send_to(
                                            &serde_json::to_vec(&response).unwrap(),
                                            src,
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        });

        let running = self.running.clone();
        let node_id = self.node_id.clone();
        let node_name = self.node_name.clone();

        tokio::spawn(async move {
            let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
            socket.set_broadcast(true).unwrap();

            while *running.lock().await {
                let announce = DiscoveryMessage::Announce {
                    id: node_id.clone(),
                    name: node_name.clone(),
                    timestamp: get_timestamp(),
                };

                let _ = socket.send_to(
                    &serde_json::to_vec(&announce).unwrap(),
                    BROADCAST_ADDR,
                );

                tokio::time::sleep(Duration::from_secs(ANNOUNCE_INTERVAL)).await;
            }
        });

        let peers = self.peers.clone();
        let running = self.running.clone();
        tokio::spawn(async move {
            while *running.lock().await {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let now = get_timestamp();
                let mut peers_lock = peers.lock().await;
                peers_lock.retain(|_, peer| now - peer.last_seen < PEER_TIMEOUT);
            }
        });

        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_broadcast(true)?;
        let discovery = DiscoveryMessage::Discovery {
            id: self.node_id.clone(),
            timestamp: get_timestamp(),
        };
        let _ = socket.send_to(&serde_json::to_vec(&discovery)?, BROADCAST_ADDR);

        Ok(())
    }

    pub async fn stop(&self) {
        *self.running.lock().await = false;
    }

    pub async fn get_peers(&self) -> Vec<serde_json::Value> {
        let peers_lock = self.peers.lock().await;
        peers_lock
            .values()
            .map(|peer| {
                serde_json::json!({
                    "id": peer.id,
                    "name": peer.name,
                    "address": peer.address,
                    "last_seen": peer.last_seen,
                })
            })
            .collect()
    }
}

fn get_timestamp() -> u64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
