use crate::config::HttpConfig;
use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

#[derive(Clone)]
pub struct HttpForwarder {
    client: Client,
    config: HttpConfig,
}

impl HttpForwarder {
    pub fn new(config: HttpConfig) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self { client, config })
    }

    pub fn update_config(&mut self, config: HttpConfig) -> Result<()> {
        self.client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .context("Failed to recreate HTTP client")?;
        self.config = config;
        Ok(())
    }

    pub async fn forward(&self, topic: &str, payload: &Value) -> Result<()> {
        let mut request = self.client.post(&self.config.api_url).json(&serde_json::json!({
            "topic": topic,
            "data": payload,
            "timestamp": chrono_now()
        }));

        if let Some(headers) = &self.config.headers {
            for (key, value) in headers {
                request = request.header(key, value);
            }
        }

        let response = request
            .send()
            .await
            .with_context(|| format!("Failed to send request to {}", self.config.api_url))?;

        let status = response.status();
        if !status.is_success() {
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<unable to read response body>".to_string());
            anyhow::bail!("HTTP request failed with status {}: {}", status, body);
        }

        log::info!("Successfully forwarded message to {} (status: {})", self.config.api_url, status);
        Ok(())
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.to_string()
}
