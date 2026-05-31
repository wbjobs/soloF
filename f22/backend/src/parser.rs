use common::{LogLevel, ParsedLogEntry, LogError};
use chrono::{DateTime, Utc, NaiveDateTime};
use serde_json::Value;
use regex::Regex;
use lazy_static::lazy_static;

lazy_static! {
    static ref TEXT_LOG_PATTERN: Regex = Regex::new(
        r"(?i)(ERROR|WARN|INFO|DEBUG)"
    ).unwrap();
}

pub fn parse_log_entry(
    server_name: &str,
    file_path: &str,
    content: &str,
    timestamp: i64,
    log_type: &str,
) -> Result<Option<ParsedLogEntry>, LogError> {
    let parsed = match log_type {
        "json" => parse_json_log(content)?,
        "text" => parse_text_log(content)?,
        _ => parse_text_log(content)?,
    };
    
    let log_level = parsed.log_level.clone();
    
    if matches!(log_level, LogLevel::ERROR) || matches!(log_level, LogLevel::WARN) {
        let entry = ParsedLogEntry {
            server_name: server_name.to_string(),
            file_path: file_path.to_string(),
            content: content.to_string(),
            timestamp: parsed.timestamp.unwrap_or_else(|| {
                DateTime::from_timestamp(timestamp, 0).unwrap_or_else(Utc::now)
            }),
            log_level,
            log_type: log_type.to_string(),
            metadata: parsed.metadata,
        };
        Ok(Some(entry))
    } else {
        Ok(None)
    }
}

struct ParsedResult {
    log_level: LogLevel,
    timestamp: Option<DateTime<Utc>>,
    metadata: Value,
}

fn parse_json_log(content: &str) -> Result<ParsedResult, LogError> {
    let json: Value = serde_json::from_str(content)
        .map_err(|e| LogError::ParseError(format!("JSON解析失败: {}", e)))?;
    
    let log_level = extract_level_from_json(&json);
    let timestamp = extract_timestamp_from_json(&json);
    
    Ok(ParsedResult {
        log_level,
        timestamp,
        metadata: json,
    })
}

fn extract_level_from_json(json: &Value) -> LogLevel {
    let level_str = json.get("level")
        .or_else(|| json.get("log_level"))
        .or_else(|| json.get("severity"))
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN");
    
    match level_str.to_uppercase().as_str() {
        "ERROR" | "ERR" | "FATAL" => LogLevel::ERROR,
        "WARN" | "WARNING" => LogLevel::WARN,
        "INFO" => LogLevel::INFO,
        "DEBUG" | "TRACE" => LogLevel::DEBUG,
        _ => LogLevel::UNKNOWN,
    }
}

fn extract_timestamp_from_json(json: &Value) -> Option<DateTime<Utc>> {
    let ts_str = json.get("timestamp")
        .or_else(|| json.get("time"))
        .or_else(|| json.get("@timestamp"))
        .and_then(|v| v.as_str())?;
    
    if let Ok(dt) = DateTime::parse_from_rfc3339(ts_str) {
        return Some(dt.with_timezone(&Utc));
    }
    
    if let Ok(naive) = NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
    }
    
    None
}

fn parse_text_log(content: &str) -> Result<ParsedResult, LogError> {
    let log_level = extract_level_from_text(content);
    let timestamp = None;
    
    Ok(ParsedResult {
        log_level,
        timestamp,
        metadata: Value::Object(serde_json::Map::new()),
    })
}

fn extract_level_from_text(content: &str) -> LogLevel {
    if let Some(caps) = TEXT_LOG_PATTERN.captures(content) {
        match caps[1].to_uppercase().as_str() {
            "ERROR" => LogLevel::ERROR,
            "WARN" => LogLevel::WARN,
            "INFO" => LogLevel::INFO,
            "DEBUG" => LogLevel::DEBUG,
            _ => LogLevel::UNKNOWN,
        }
    } else {
        LogLevel::UNKNOWN
    }
}
