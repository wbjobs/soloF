use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use uuid::Uuid;

pub const DEFAULT_RELAY_PORT: u16 = 45679;
const HEARTBEAT_INTERVAL: u64 = 5;
const NODE_TIMEOUT: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub id: String,
    pub name: String,
    pub address: String,
    pub last_seen: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum RelayMessage {
    Register {
        id: String,
        name: String,
    },
    Heartbeat {
        id: String,
    },
    NodeList {
        nodes: Vec<NodeInfo>,
    },
    Broadcast {
        from_id: String,
        message: String,
    },
    Unregister {
        id: String,
    },
}

type SharedNodes = Arc<Mutex<HashMap<String, (NodeInfo, Instant)>>>;

pub struct RelayServer {
    port: Option<u16>,
    running: Arc<Mutex<bool>>,
    nodes: SharedNodes,
    tasks: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl RelayServer {
    pub fn new() -> Self {
        Self {
            port: None,
            running: Arc::new(Mutex::new(false)),
            nodes: Arc::new(Mutex::new(HashMap::new())),
            tasks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn start(&mut self, port: Option<u16>) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
        let port = port.unwrap_or(DEFAULT_RELAY_PORT);
        let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
        let actual_port = listener.local_addr()?.port();
        self.port = Some(actual_port);
        *self.running.lock().await = true;

        let running = self.running.clone();
        let nodes = self.nodes.clone();
        let tasks = self.tasks.clone();

        let task = tokio::spawn(async move {
            while *running.lock().await {
                match tokio::time::timeout(Duration::from_millis(100), listener.accept()).await {
                    Ok(Ok((stream, addr))) => {
                        println!("New relay client connected: {}", addr);
                        let client_task = tokio::spawn(handle_client(stream, addr, nodes.clone(), running.clone()));
                        tasks.lock().await.push(client_task);
                    }
                    _ => {}
                }
            }
        });

        self.tasks.lock().await.push(task);
        Ok(actual_port)
    }

    pub async fn stop(&mut self) {
        *self.running.lock().await = false;
        let mut tasks = self.tasks.lock().await;
        for task in tasks.drain(..) {
            task.abort();
        }
    }

    pub async fn get_nodes(&self) -> Vec<NodeInfo> {
        let mut nodes_lock = self.nodes.lock().await;
        let now = Instant::now();
        nodes_lock.retain(|_, (_, last_seen)| {
            now.duration_since(*last_seen) < Duration::from_secs(NODE_TIMEOUT)
        });

        nodes_lock
            .values()
            .map(|(info, _)| info.clone())
            .collect()
    }

    pub fn is_running(&self) -> bool {
        self.port.is_some()
    }

    pub fn get_port(&self) -> Option<u16> {
        self.port
    }
}

impl Default for RelayServer {
    fn default() -> Self {
        Self::new()
    }
}

async fn handle_client(
    mut stream: TcpStream,
    addr: SocketAddr,
    nodes: SharedNodes,
    running: Arc<Mutex<bool>>,
) {
    let mut buffer = [0; 4096];
    let mut node_id: Option<String> = None;

    while *running.lock().await {
        match tokio::time::timeout(Duration::from_secs(1), stream.readable()).await {
            Ok(Ok(_)) => match stream.try_read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if let Ok(msg) = serde_json::from_slice::<RelayMessage>(&buffer[..n]) {
                        match msg {
                            RelayMessage::Register { id, name } => {
                                let node_info = NodeInfo {
                                    id: id.clone(),
                                    name,
                                    address: addr.to_string(),
                                    last_seen: get_timestamp(),
                                };
                                let mut nodes_lock = nodes.lock().await;
                                nodes_lock.insert(id.clone(), (node_info, Instant::now()));
                                node_id = Some(id);
                                println!("Node registered: {}", id);
                            }
                            RelayMessage::Heartbeat { id } => {
                                let mut nodes_lock = nodes.lock().await;
                                if let Some((node_info, last_seen)) = nodes_lock.get_mut(&id) {
                                    node_info.last_seen = get_timestamp();
                                    *last_seen = Instant::now();
                                }
                            }
                            RelayMessage::Unregister { id } => {
                                let mut nodes_lock = nodes.lock().await;
                                nodes_lock.remove(&id);
                                println!("Node unregistered: {}", id);
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Err(_) => {}
            },
            _ => {}
        }
    }

    if let Some(id) = node_id {
        nodes.lock().await.remove(&id);
    }
}

pub struct RelayClient {
    node_id: String,
    node_name: String,
    server_addr: Option<String>,
    running: Arc<Mutex<bool>>,
    stream: Arc<Mutex<Option<TcpStream>>>,
    nodes: Arc<Mutex<Vec<NodeInfo>>>,
    heartbeat_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    receive_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl RelayClient {
    pub fn new() -> Self {
        let node_id = Uuid::new_v4().to_string();
        let hostname = gethostname::gethostname();
        let node_name = hostname.to_string_lossy().to_string();

        Self {
            node_id,
            node_name,
            server_addr: None,
            running: Arc::new(Mutex::new(false)),
            stream: Arc::new(Mutex::new(None)),
            nodes: Arc::new(Mutex::new(Vec::new())),
            heartbeat_task: Arc::new(Mutex::new(None)),
            receive_task: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn connect(&mut self, server_addr: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let stream = TcpStream::connect(server_addr).await?;
        *self.stream.lock().await = Some(stream);
        self.server_addr = Some(server_addr.to_string());
        *self.running.lock().await = true;

        self.register().await?;
        self.start_heartbeat().await;
        self.start_receive().await;

        Ok(())
    }

    async fn register(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let msg = RelayMessage::Register {
            id: self.node_id.clone(),
            name: self.node_name.clone(),
        };
        self.send_message(&msg).await
    }

    async fn send_message(&self, msg: &RelayMessage) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(stream) = &mut *self.stream.lock().await {
            let data = serde_json::to_vec(msg)?;
            stream.writable().await?;
            stream.try_write(&data)?;
        }
        Ok(())
    }

    async fn start_heartbeat(&self) {
        let running = self.running.clone();
        let node_id = self.node_id.clone();
        let stream = self.stream.clone();

        let task = tokio::spawn(async move {
            while *running.lock().await {
                tokio::time::sleep(Duration::from_secs(HEARTBEAT_INTERVAL)).await;
                
                let msg = RelayMessage::Heartbeat { id: node_id.clone() };
                if let Ok(data) = serde_json::to_vec(&msg) {
                    if let Some(stream) = &mut *stream.lock().await {
                        let _ = stream.writable().await;
                        let _ = stream.try_write(&data);
                    }
                }
            }
        });

        *self.heartbeat_task.lock().await = Some(task);
    }

    async fn start_receive(&self) {}

    pub async fn disconnect(&mut self) {
        let msg = RelayMessage::Unregister {
            id: self.node_id.clone(),
        };
        let _ = self.send_message(&msg).await;

        *self.running.lock().await = false;

        if let Some(task) = self.heartbeat_task.lock().await.take() {
            task.abort();
        }
        if let Some(task) = self.receive_task.lock().await.take() {
            task.abort();
        }

        *self.stream.lock().await = None;
        self.server_addr = None;
    }

    pub fn get_node_id(&self) -> &str {
        &self.node_id
    }

    pub fn is_connected(&self) -> bool {
        self.server_addr.is_some()
    }

    pub fn get_server_addr(&self) -> Option<String> {
        self.server_addr.clone()
    }

    pub async fn get_nodes(&self) -> Vec<NodeInfo> {
        self.nodes.lock().await.clone()
    }
}

impl Default for RelayClient {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn discover_relay_servers() -> Vec<String> {
    let mut servers = Vec::new();
    
    if let Ok(local_ip) = local_ip_address::local_ip() {
        if let std::net::IpAddr::V4(ipv4) = local_ip {
            let octets = ipv4.octets();
            let mut tasks = Vec::new();
            
            for i in 1..255 {
                let test_addr = format!("{}.{}.{}.{}:{}", octets[0], octets[1], octets[2], i, DEFAULT_RELAY_PORT);
                tasks.push(tokio::spawn(async move {
                    if tokio::time::timeout(Duration::from_millis(20), TcpStream::connect(&test_addr)).await.is_ok() {
                        Some(test_addr)
                    } else {
                        None
                    }
                }));
            }

            for task in tasks {
                if let Ok(Some(addr)) = task.await {
                    servers.push(addr);
                }
            }
        }
    }
    
    servers.push(format!("127.0.0.1:{}", DEFAULT_RELAY_PORT));
    servers
}

fn get_timestamp() -> u64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
