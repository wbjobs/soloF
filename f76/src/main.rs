mod config;
mod filter;
mod http_forwarder;
mod metrics;
mod mqtt_client;

use crate::config::{watch_config, AppConfig, ConfigWatcher};
use crate::filter::should_forward;
use crate::http_forwarder::HttpForwarder;
use crate::metrics::{Metrics, MetricsServer};
use crate::mqtt_client::{create_mqtt_client, MqttClientHandle, MAX_QUEUE_SIZE};
use anyhow::{Context, Result};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

struct BridgeState {
    mqtt_config: config::MqttConfig,
    http_config: config::HttpConfig,
    rules: Vec<config::Rule>,
    metrics_config: config::MetricsConfig,
}

impl BridgeState {
    fn from_config(config: &AppConfig) -> Self {
        Self {
            mqtt_config: config.mqtt.clone(),
            http_config: config.http.clone(),
            rules: config.rules.clone(),
            metrics_config: config.metrics.clone(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    log::info!("Starting MQTT Bridge Service...");

    let config_path = Path::new("config.toml");
    let (_tx, config_rx) = watch_config(config_path)
        .await
        .context("Failed to start config watcher")?;

    let initial_config = config_rx.borrow().clone();
    log::info!("Loaded initial configuration");

    run_bridge(initial_config, config_rx).await?;

    Ok(())
}

async fn run_bridge(initial_config: AppConfig, mut config_rx: ConfigWatcher) -> Result<()> {
    let metrics = Arc::new(Metrics::new().context("Failed to create metrics registry")?);
    let mut metrics_server = MetricsServer::new(initial_config.metrics.clone(), Arc::clone(&metrics));
    metrics_server.start().await?;

    let state = Arc::new(Mutex::new(BridgeState::from_config(&initial_config)));

    let mqtt_client = create_mqtt_client(&initial_config)
        .await
        .context("Failed to create MQTT client")?;
    metrics.record_mqtt_connect();

    let http_forwarder = Arc::new(Mutex::new(
        HttpForwarder::new(initial_config.http.clone())
            .context("Failed to create HTTP forwarder")?,
    ));

    log::info!(
        "Bridge service initialized. Max message queue size: {}",
        MAX_QUEUE_SIZE
    );

    let mqtt_client = Arc::new(Mutex::new(Some(mqtt_client)));

    tokio::spawn({
        let mqtt_client = Arc::clone(&mqtt_client);
        let http_forwarder = Arc::clone(&http_forwarder);
        let state = Arc::clone(&state);
        let metrics = Arc::clone(&metrics);

        async move {
            if let Err(e) = message_worker(mqtt_client, http_forwarder, state, metrics).await {
                log::error!("Message worker crashed: {}", e);
            }
        }
    });

    loop {
        tokio::select! {
            _ = config_rx.changed() => {
                let new_config = config_rx.borrow_and_update().clone();
                log::info!("Configuration update received, applying changes atomically...");

                let state_guard = state.lock().await;
                let mqtt_changed = new_config.mqtt != state_guard.mqtt_config;
                let http_changed = new_config.http != state_guard.http_config;
                let metrics_changed = new_config.metrics != state_guard.metrics_config;
                drop(state_guard);

                if mqtt_changed {
                    log::info!("MQTT configuration changed, initiating reconnect...");
                    metrics.record_mqtt_disconnect();
                    let mut mqtt_guard = mqtt_client.lock().await;
                    if let Some(client) = mqtt_guard.take() {
                        drop(client);
                    }

                    match create_mqtt_client(&new_config).await {
                        Ok(new_client) => {
                            *mqtt_guard = Some(new_client);
                            metrics.record_mqtt_connect();
                            log::info!("MQTT client reconnected successfully");
                        }
                        Err(e) => {
                            log::error!("Failed to create new MQTT client: {}", e);
                        }
                    }
                }

                if http_changed {
                    log::info!("HTTP configuration changed, updating forwarder...");
                    let mut http_guard = http_forwarder.lock().await;
                    if let Err(e) = http_guard.update_config(new_config.http.clone()) {
                        log::error!("Failed to update HTTP forwarder: {}", e);
                    } else {
                        log::info!("HTTP forwarder updated successfully");
                    }
                }

                if metrics_changed {
                    log::info!("Metrics configuration changed, updating server...");
                    if let Err(e) = metrics_server.update_config(new_config.metrics.clone()).await {
                        log::error!("Failed to update metrics server: {}", e);
                    } else {
                        log::info!("Metrics server updated successfully");
                    }
                }

                let mut state_guard = state.lock().await;
                state_guard.mqtt_config = new_config.mqtt.clone();
                state_guard.http_config = new_config.http.clone();
                state_guard.rules = new_config.rules.clone();
                state_guard.metrics_config = new_config.metrics.clone();
                drop(state_guard);

                log::info!(
                    "Config reload complete. Active rules: {}, MQTT: {}, HTTP: {}, Metrics: {}",
                    new_config.rules.len(),
                    if mqtt_changed { "reconnected" } else { "unchanged" },
                    if http_changed { "updated" } else { "unchanged" },
                    if metrics_changed { "updated" } else { "unchanged" }
                );
            }
        }
    }
}

async fn message_worker(
    mqtt_client: Arc<Mutex<Option<MqttClientHandle>>>,
    http_forwarder: Arc<Mutex<HttpForwarder>>,
    state: Arc<Mutex<BridgeState>>,
    metrics: Arc<Metrics>,
) -> Result<()> {
    loop {
        let message_opt = {
            let client_guard = mqtt_client.lock().await;
            if let Some(client) = &*client_guard {
                client.message_rx.recv().await
            } else {
                drop(client_guard);
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                continue;
            }
        };

        let Some(message) = message_opt else {
            log::warn!("MQTT message channel closed, restarting worker...");
            metrics.record_mqtt_disconnect();
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            continue;
        };

        metrics.record_mqtt_message(&message.topic);

        let should_forward_result = {
            let state_guard = state.lock().await;
            should_forward(&state_guard.rules, &message.payload)
        };

        if should_forward_result {
            log::info!(
                "Message on topic '{}' matches filter rules, forwarding...",
                message.topic
            );

            let start_time = Instant::now();
            let forward_result = {
                let forwarder = http_forwarder.lock().await;
                forwarder.forward(&message.topic, &message.payload).await
            };
            let duration = start_time.elapsed();

            match forward_result {
                Ok(_) => {
                    metrics.record_forward_success(duration);
                }
                Err(e) => {
                    metrics.record_forward_failure(duration);
                    log::error!("Failed to forward message: {}", e);
                }
            }
        } else {
            metrics.record_filtered();
            log::debug!(
                "Message on topic '{}' did not match any filter rules",
                message.topic
            );
        }
    }
}
