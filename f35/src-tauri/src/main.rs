#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod file_watcher;
mod p2p_discovery;
mod hash_manager;
mod tcp_relay;

use file_watcher::FileWatcher;
use p2p_discovery::P2PDiscovery;
use hash_manager::HashManager;
use tcp_relay::{RelayServer, RelayClient};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub enum DiscoveryMode {
    UDP,
    TCPRelay,
}

pub struct AppState {
    pub file_watcher: Arc<Mutex<Option<FileWatcher>>>,
    pub p2p_discovery: Arc<Mutex<P2PDiscovery>>,
    pub hash_manager: Arc<Mutex<HashManager>>,
    pub notes_path: Arc<Mutex<Option<String>>>,
    pub relay_server: Arc<Mutex<RelayServer>>,
    pub relay_client: Arc<Mutex<RelayClient>>,
    pub discovery_mode: Arc<Mutex<DiscoveryMode>>,
}

#[tokio::main]
async fn main() {
    let p2p = P2PDiscovery::new().await;
    let hash_manager = HashManager::new();
    let relay_server = RelayServer::new();
    let relay_client = RelayClient::new();
    
    tauri::Builder::default()
        .manage(AppState {
            file_watcher: Arc::new(Mutex::new(None)),
            p2p_discovery: Arc::new(Mutex::new(p2p)),
            hash_manager: Arc::new(Mutex::new(hash_manager)),
            notes_path: Arc::new(Mutex::new(None)),
            relay_server: Arc::new(Mutex::new(relay_server)),
            relay_client: Arc::new(Mutex::new(relay_client)),
            discovery_mode: Arc::new(Mutex::new(DiscoveryMode::UDP)),
        })
        .invoke_handler(tauri::generate_handler![
            set_notes_directory,
            get_notes_directory,
            get_file_tree,
            read_file_content,
            save_file_content,
            create_new_file,
            delete_file,
            start_p2p_discovery,
            stop_p2p_discovery,
            get_discovered_peers,
            get_file_hashes,
            calculate_file_hash,
            start_relay_server,
            stop_relay_server,
            connect_to_relay,
            disconnect_from_relay,
            get_relay_peers,
            discover_relay_servers,
            get_discovery_mode,
            set_discovery_mode,
            get_relay_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn set_notes_directory(
    path: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut notes_path = state.notes_path.lock().await;
    *notes_path = Some(path.clone());
    
    let mut hash_manager = state.hash_manager.lock().await;
    hash_manager.set_base_path(&path);
    hash_manager.load_hashes().map_err(|e| e.to_string())?;
    
    let mut fw_guard = state.file_watcher.lock().await;
    if let Some(fw) = fw_guard.take() {
        fw.stop().await;
    }
    
    let file_watcher = FileWatcher::new(&path, app_handle.clone()).await.map_err(|e| e.to_string())?;
    *fw_guard = Some(file_watcher);
    
    Ok(path)
}

#[tauri::command]
async fn get_notes_directory(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let path = state.notes_path.lock().await;
    Ok(path.clone())
}

#[tauri::command]
async fn get_file_tree(path: String) -> Result<Vec<serde_json::Value>, String> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        
        if name.starts_with('.') {
            continue;
        }
        
        entries.push(serde_json::json!({
            "name": name,
            "path": entry.path().to_string_lossy().to_string(),
            "is_dir": file_type.is_dir(),
            "is_file": file_type.is_file(),
        }));
    }
    
    entries.sort_by(|a, b| {
        let a_is_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_is_dir = b["is_dir"].as_bool().unwrap_or(false);
        if a_is_dir != b_is_dir {
            b_is_dir.cmp(&a_is_dir)
        } else {
            a["name"].as_str().cmp(&b["name"].as_str())
        }
    });
    
    Ok(entries)
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_file_content(
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    
    let mut hash_manager = state.hash_manager.lock().await;
    hash_manager.update_file_hash(&path).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn create_new_file(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn delete_file(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn start_p2p_discovery(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut p2p = state.p2p_discovery.lock().await;
    p2p.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_p2p_discovery(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut p2p = state.p2p_discovery.lock().await;
    p2p.stop().await;
    Ok(())
}

#[tauri::command]
async fn get_discovered_peers(state: tauri::State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let p2p = state.p2p_discovery.lock().await;
    Ok(p2p.get_peers().await)
}

#[tauri::command]
async fn get_file_hashes(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let hash_manager = state.hash_manager.lock().await;
    Ok(hash_manager.get_all_hashes())
}

#[tauri::command]
async fn calculate_file_hash(path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let hash_manager = state.hash_manager.lock().await;
    hash_manager.calculate_hash(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_relay_server(
    port: Option<u16>,
    state: tauri::State<'_, AppState>,
) -> Result<u16, String> {
    let mut server = state.relay_server.lock().await;
    server.start(port).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_relay_server(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut server = state.relay_server.lock().await;
    server.stop().await;
    Ok(())
}

#[tauri::command]
async fn connect_to_relay(
    server_addr: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut client = state.relay_client.lock().await;
    client.connect(&server_addr).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn disconnect_from_relay(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut client = state.relay_client.lock().await;
    client.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn get_relay_peers(state: tauri::State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let server = state.relay_server.lock().await;
    let nodes = server.get_nodes().await;
    Ok(nodes
        .into_iter()
        .map(|node| {
            serde_json::json!({
                "id": node.id,
                "name": node.name,
                "address": node.address,
                "last_seen": node.last_seen,
            })
        })
        .collect())
}

#[tauri::command]
async fn discover_relay_servers() -> Result<Vec<String>, String> {
    Ok(tcp_relay::discover_relay_servers().await)
}

#[tauri::command]
async fn get_discovery_mode(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let mode = state.discovery_mode.lock().await;
    match *mode {
        DiscoveryMode::UDP => Ok("UDP".to_string()),
        DiscoveryMode::TCPRelay => Ok("TCPRelay".to_string()),
    }
}

#[tauri::command]
async fn set_discovery_mode(mode: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut discovery_mode = state.discovery_mode.lock().await;
    match mode.as_str() {
        "UDP" => *discovery_mode = DiscoveryMode::UDP,
        "TCPRelay" => *discovery_mode = DiscoveryMode::TCPRelay,
        _ => return Err("Invalid discovery mode".to_string()),
    }
    Ok(())
}

#[tauri::command]
async fn get_relay_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let server = state.relay_server.lock().await;
    let client = state.relay_client.lock().await;
    
    Ok(serde_json::json!({
        "server_running": server.is_running(),
        "server_port": server.get_port(),
        "client_connected": client.is_connected(),
        "client_server": client.get_server_addr(),
    }))
}
