use crate::config::MetricsConfig;
use anyhow::{Context, Result};
use hyper::{Body, Request, Response, Server, StatusCode};
use hyper::service::{make_service_fn, service_fn};
use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounter, IntCounterVec, IntGauge, Opts, Registry,
    TextEncoder,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,

    pub mqtt_connection_status: IntGauge,
    pub mqtt_messages_total: IntCounterVec,
    pub mqtt_messages_dropped_total: IntCounter,

    pub http_requests_total: IntCounterVec,
    pub http_request_duration_seconds: HistogramVec,

    pub bridge_forwarded_messages_total: IntCounter,
    pub bridge_filtered_messages_total: IntCounter,
}

impl Metrics {
    pub fn new() -> Result<Self> {
        let registry = Registry::new();

        let mqtt_connection_status = IntGauge::new(
            "mqtt_connection_status",
            "MQTT broker connection status (1 = connected, 0 = disconnected)",
        )?;

        let mqtt_messages_total = IntCounterVec::new(
            Opts::new("mqtt_messages_total", "Total number of MQTT messages received"),
            &["topic"],
        )?;

        let mqtt_messages_dropped_total = IntCounter::new(
            "mqtt_messages_dropped_total",
            "Total number of MQTT messages dropped due to full queue",
        )?;

        let http_requests_total = IntCounterVec::new(
            Opts::new("http_requests_total", "Total number of HTTP requests made"),
            &["status"],
        )?;

        let http_request_duration_seconds = HistogramVec::new(
            HistogramOpts::new(
                "http_request_duration_seconds",
                "HTTP request duration in seconds",
            )
            .buckets(vec![0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]),
            &["status"],
        )?;

        let bridge_forwarded_messages_total = IntCounter::new(
            "bridge_forwarded_messages_total",
            "Total number of messages forwarded to cloud API",
        )?;

        let bridge_filtered_messages_total = IntCounter::new(
            "bridge_filtered_messages_total",
            "Total number of messages filtered out by rules",
        )?;

        registry.register(Box::new(mqtt_connection_status.clone()))?;
        registry.register(Box::new(mqtt_messages_total.clone()))?;
        registry.register(Box::new(mqtt_messages_dropped_total.clone()))?;
        registry.register(Box::new(http_requests_total.clone()))?;
        registry.register(Box::new(http_request_duration_seconds.clone()))?;
        registry.register(Box::new(bridge_forwarded_messages_total.clone()))?;
        registry.register(Box::new(bridge_filtered_messages_total.clone()))?;

        if let Ok(process_collector) = prometheus::process_collector::ProcessCollector::for_self() {
            let _ = registry.register(Box::new(process_collector));
        }

        Ok(Self {
            registry,
            mqtt_connection_status,
            mqtt_messages_total,
            mqtt_messages_dropped_total,
            http_requests_total,
            http_request_duration_seconds,
            bridge_forwarded_messages_total,
            bridge_filtered_messages_total,
        })
    }

    pub fn record_mqtt_message(&self, topic: &str) {
        self.mqtt_messages_total.with_label_values(&[topic]).inc();
    }

    pub fn record_mqtt_disconnect(&self) {
        self.mqtt_connection_status.set(0);
    }

    pub fn record_mqtt_connect(&self) {
        self.mqtt_connection_status.set(1);
    }

    pub fn record_dropped_message(&self) {
        self.mqtt_messages_dropped_total.inc();
    }

    pub fn record_forward_success(&self, duration: std::time::Duration) {
        self.bridge_forwarded_messages_total.inc();
        self.http_requests_total.with_label_values(&["success"]).inc();
        self.http_request_duration_seconds
            .with_label_values(&["success"])
            .observe(duration.as_secs_f64());
    }

    pub fn record_forward_failure(&self, duration: std::time::Duration) {
        self.http_requests_total.with_label_values(&["error"]).inc();
        self.http_request_duration_seconds
            .with_label_values(&["error"])
            .observe(duration.as_secs_f64());
    }

    pub fn record_filtered(&self) {
        self.bridge_filtered_messages_total.inc();
    }

    fn gather(&self) -> String {
        let mut buffer = vec![];
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        encoder.encode(&metric_families, &mut buffer).unwrap_or_default();
        String::from_utf8(buffer).unwrap_or_default()
    }
}

pub struct MetricsServer {
    config: MetricsConfig,
    metrics: Arc<Metrics>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl MetricsServer {
    pub fn new(config: MetricsConfig, metrics: Arc<Metrics>) -> Self {
        Self {
            config,
            metrics,
            shutdown_tx: None,
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        if !self.config.enabled {
            log::info!("Metrics server is disabled in configuration");
            return Ok(());
        }

        self.stop().await;

        let addr: SocketAddr = format!("{}:{}", self.config.host, self.config.port)
            .parse()
            .with_context(|| format!("Invalid metrics endpoint: {}:{}", self.config.host, self.config.port))?;

        let metrics = Arc::clone(&self.metrics);
        let endpoint = self.config.endpoint.clone();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        self.shutdown_tx = Some(shutdown_tx);

        let make_svc = make_service_fn(move |_conn| {
            let metrics = Arc::clone(&metrics);
            let endpoint = endpoint.clone();
            async move {
                Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                    let metrics = Arc::clone(&metrics);
                    let endpoint = endpoint.clone();
                    async move {
                        if req.uri().path() == endpoint {
                            let body = metrics.gather();
                            Response::builder()
                                .header("Content-Type", "text/plain; version=0.0.4")
                                .body(Body::from(body))
                        } else {
                            Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Body::from("Not Found"))
                        }
                    }
                }))
            }
        });

        let server = Server::bind(&addr).serve(make_svc);

        tokio::spawn(async move {
            log::info!("Prometheus metrics server starting on http://{}{}", addr, endpoint);

            let graceful = server.with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                log::info!("Metrics server shutdown signal received");
            });

            if let Err(e) = graceful.await {
                log::error!("Metrics server error: {}", e);
            }
        });

        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    pub async fn update_config(&mut self, new_config: MetricsConfig) -> Result<()> {
        let config_changed = new_config != self.config;
        self.config = new_config;

        if config_changed {
            log::info!("Metrics configuration changed, restarting server...");
            self.start().await?;
        }

        Ok(())
    }
}

impl Drop for MetricsServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}
