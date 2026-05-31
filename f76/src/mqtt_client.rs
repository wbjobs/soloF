use crate::config::{AppConfig, MqttConfig};
use anyhow::Context;
use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, QoS};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, oneshot};

pub const MAX_QUEUE_SIZE: usize = 500;

pub struct MqttMessage {
    pub topic: String,
    pub payload: Value,
}

pub struct MqttClientHandle {
    pub message_rx: mpsc::Receiver<MqttMessage>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    inner: Arc<Mutex<MqttClientInner>>,
}

struct MqttClientInner {
    client: AsyncClient,
    eventloop: EventLoop,
    config: MqttConfig,
}

impl MqttClientHandle {
    pub async fn new(config: MqttConfig) -> anyhow::Result<Self> {
        let (tx, rx) = mpsc::channel::<MqttMessage>(MAX_QUEUE_SIZE);
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let inner = Arc::new(Mutex::new(MqttClientInner::new(config)?));

        let inner_clone = inner.clone();
        tokio::spawn(async move {
            if let Err(e) = mqtt_event_loop(inner_clone, tx, shutdown_rx).await {
                log::error!("MQTT event loop crashed: {}", e);
            }
        });

        Ok(Self {
            message_rx: rx,
            shutdown_tx: Some(shutdown_tx),
            inner,
        })
    }

    pub async fn reconnect(&self, new_config: MqttConfig) -> anyhow::Result<()> {
        let mut inner = self.inner.lock().await;
        inner.reconnect(new_config).await
    }

    pub async fn resubscribe(&self) -> anyhow::Result<()> {
        let inner = self.inner.lock().await;
        inner.subscribe_topics().await
    }
}

impl Drop for MqttClientHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            log::debug!("Sent shutdown signal to MQTT event loop");
        }
    }
}

impl MqttClientInner {
    fn new(config: MqttConfig) -> anyhow::Result<Self> {
        let mut mqtt_options = MqttOptions::new(&config.client_id, &config.broker, config.port);
        mqtt_options.set_keep_alive(Duration::from_secs(config.keep_alive));
        mqtt_options.set_inflight(100);
        mqtt_options.set_pending_throttle(Duration::from_millis(10));

        if let (Some(username), Some(password)) = (&config.username, &config.password) {
            if !username.is_empty() {
                mqtt_options.set_credentials(username, password);
            }
        }

        let (client, eventloop) = AsyncClient::new(mqtt_options, 256);

        Ok(Self {
            client,
            eventloop,
            config,
        })
    }

    async fn subscribe_topics(&self) -> anyhow::Result<()> {
        for topic in &self.config.topics {
            self.client
                .subscribe(topic, QoS::AtLeastOnce)
                .await
                .with_context(|| format!("Failed to subscribe to topic: {}", topic))?;
            log::info!("Subscribed to topic: {}", topic);
        }
        Ok(())
    }

    async fn reconnect(&mut self, new_config: MqttConfig) -> anyhow::Result<()> {
        let mut mqtt_options = MqttOptions::new(&new_config.client_id, &new_config.broker, new_config.port);
        mqtt_options.set_keep_alive(Duration::from_secs(new_config.keep_alive));
        mqtt_options.set_inflight(100);
        mqtt_options.set_pending_throttle(Duration::from_millis(10));

        if let (Some(username), Some(password)) = (&new_config.username, &new_config.password) {
            if !username.is_empty() {
                mqtt_options.set_credentials(username, password);
            }
        }

        let (new_client, new_eventloop) = AsyncClient::new(mqtt_options, 256);

        self.client = new_client;
        self.eventloop = new_eventloop;
        self.config = new_config;

        Ok(())
    }
}

async fn mqtt_event_loop(
    inner: Arc<Mutex<MqttClientInner>>,
    tx: mpsc::Sender<MqttMessage>,
    mut shutdown_rx: oneshot::Receiver<()>,
) -> anyhow::Result<()> {
    loop {
        let event = tokio::select! {
            _ = &mut shutdown_rx => {
                log::info!("MQTT event loop received shutdown signal, exiting");
                return Ok(());
            }
            result = async {
                let mut guard = inner.lock().await;
                guard.eventloop.poll().await
            } => result
        };

        match event {
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                let topic = publish.topic.clone();
                match serde_json::from_slice::<Value>(&publish.payload) {
                    Ok(json) => {
                        log::debug!("Received message on topic {}: {}", topic, json);
                        let msg = MqttMessage {
                            topic,
                            payload: json,
                        };

                        match tx.try_send(msg) {
                            Ok(_) => {}
                            Err(mpsc::error::TrySendError::Full(_)) => {
                                log::warn!(
                                    "Message queue full (max: {}), dropping message for topic: {}",
                                    MAX_QUEUE_SIZE,
                                    topic
                                );
                            }
                            Err(mpsc::error::TrySendError::Closed(_)) => {
                                log::error!("Message channel closed, exiting MQTT event loop");
                                return Ok(());
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to parse JSON from topic {}: {}", topic, e);
                    }
                }
            }
            Ok(Event::Incoming(Packet::ConnAck(conn_ack))) => {
                log::info!("Connected to MQTT broker: session present = {}", conn_ack.session_present);
                let guard = inner.lock().await;
                if let Err(e) = guard.subscribe_topics().await {
                    log::error!("Failed to subscribe after reconnect: {}", e);
                }
            }
            Ok(Event::Outgoing(rumqttc::Outgoing::Disconnect)) => {
                log::info!("MQTT client disconnected");
                break;
            }
            Ok(_event) => {
                log::trace!("MQTT event: {:?}", _event);
            }
            Err(e) => {
                log::error!("MQTT error: {}, reconnecting in 1s...", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    Ok(())
}

pub async fn create_mqtt_client(config: &AppConfig) -> anyhow::Result<MqttClientHandle> {
    let client = MqttClientHandle::new(config.mqtt.clone()).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(client)
}
