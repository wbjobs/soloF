pub mod log_service {
    tonic::include_proto!("log_service");
}

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LogLevel {
    ERROR,
    WARN,
    INFO,
    DEBUG,
    UNKNOWN,
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LogLevel::ERROR => write!(f, "ERROR"),
            LogLevel::WARN => write!(f, "WARN"),
            LogLevel::INFO => write!(f, "INFO"),
            LogLevel::DEBUG => write!(f, "DEBUG"),
            LogLevel::UNKNOWN => write!(f, "UNKNOWN"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedLogEntry {
    pub server_name: String,
    pub file_path: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub log_level: LogLevel,
    pub log_type: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("gRPC error: {0}")]
    GrpcError(#[from] tonic::Status),
    #[error("Elasticsearch error: {0}")]
    ElasticsearchError(String),
}
