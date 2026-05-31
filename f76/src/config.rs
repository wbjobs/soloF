use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Mutex};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MqttConfig {
    pub broker: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub topics: Vec<String>,
    pub keep_alive: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HttpConfig {
    pub api_url: String,
    pub timeout_secs: u64,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    pub field: String,
    pub operator: String,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricsConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub endpoint: String,
}

impl Default for MetricsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: "127.0.0.1".to_string(),
            port: 9090,
            endpoint: "/metrics".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    pub mqtt: MqttConfig,
    pub http: HttpConfig,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub metrics: MetricsConfig,
}

impl AppConfig {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: AppConfig = toml::from_str(&content)?;
        Ok(config)
    }
}

pub type ConfigWatcher = watch::Receiver<AppConfig>;

const CONFIG_DEBOUNCE_MS: u64 = 500;

pub async fn watch_config(path: &Path) -> anyhow::Result<(watch::Sender<AppConfig>, ConfigWatcher)> {
    let config = AppConfig::load(path)?;
    let (tx, rx) = watch::channel(config);

    let path = path.to_path_buf();
    let tx_clone = tx.clone();

    tokio::spawn(async move {
        use notify::{RecommendedWatcher, RecursiveMode, Watcher};

        let (notify_tx, mut notify_rx) = tokio::sync::mpsc::unbounded_channel();
        let reload_mutex = Arc::new(Mutex::new(()));

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = notify_tx.send(res);
            },
            notify::Config::default().with_poll_interval(Duration::from_secs(2)),
        )
        .expect("Failed to create file watcher");

        watcher
            .watch(&path, RecursiveMode::NonRecursive)
            .expect("Failed to watch config file");

        log::info!("Config file watcher started for: {:?}", path);

        let mut debounce_handle: Option<tokio::task::JoinHandle<()>> = None;

        while let Some(result) = notify_rx.recv().await {
            match result {
                Ok(event) => {
                    if event.kind.is_modify() || event.kind.is_create() || event.kind.is_rename() {
                        log::debug!("Config file change detected, starting debounce timer");

                        if let Some(handle) = debounce_handle.take() {
                            handle.abort();
                        }

                        let path_clone = path.clone();
                        let tx_clone = tx_clone.clone();
                        let reload_mutex = Arc::clone(&reload_mutex);

                        debounce_handle = Some(tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(CONFIG_DEBOUNCE_MS)).await;

                            let _guard = reload_mutex.lock().await;

                            log::info!("Config file debounce complete, reloading...");
                            match AppConfig::load(&path_clone) {
                                Ok(new_config) => {
                                    let current = tx_clone.borrow().clone();
                                    if new_config != current {
                                        if tx_clone.send(new_config).is_ok() {
                                            log::info!("Config reloaded successfully");
                                        } else {
                                            log::warn!("No active receivers for config update");
                                        }
                                    } else {
                                        log::info!("Config unchanged, skipping reload");
                                    }
                                }
                                Err(e) => {
                                    log::error!("Failed to reload config: {}", e);
                                }
                            }
                        }));
                    }
                }
                Err(e) => {
                    log::error!("Config watch error: {}", e);
                }
            }
        }

        if let Some(handle) = debounce_handle {
            handle.abort();
        }
    });

    Ok((tx, rx))
}
