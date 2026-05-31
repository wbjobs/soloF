mod parser;
mod elasticsearch;
mod grpc_service;

use actix_web::{web, App, HttpServer, Responder, HttpResponse, get};
use common::log_service::log_service_server::LogServiceServer;
use elasticsearch::ElasticsearchClient;
use grpc_service::LogServiceImpl;
use std::env;
use tracing::{info, warn, error, debug};
use tonic::transport::Server as TonicServer;
use chrono::{DateTime, Utc, TimeZone};

#[derive(serde::Deserialize)]
struct AppConfig {
    http_port: u16,
    grpc_port: u16,
    es_url: String,
    es_index_prefix: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            http_port: 8080,
            grpc_port: 50051,
            es_url: "http://localhost:9200".to_string(),
            es_index_prefix: "logs".to_string(),
        }
    }
}

#[derive(serde::Deserialize)]
struct LogQueryParams {
    start: Option<String>,
    end: Option<String>,
    level: Option<String>,
    limit: Option<usize>,
}

fn parse_iso8601_time(s: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            Utc.datetime_from_str(s, "%Y-%m-%dT%H:%M:%S")
                .map_err(|e| format!("时间解析失败: {}", e))
        })
        .map_err(|e| e.to_string())
}

async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "log-collector-backend"
    }))
}

#[get("/api/logs/errors")]
async fn query_error_logs(
    es_client: web::Data<Option<ElasticsearchClient>>,
    query: web::Query<LogQueryParams>,
) -> impl Responder {
    let es_client = match es_client.get_ref() {
        Some(client) => client,
        None => {
            return HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": "Elasticsearch 未配置",
                "status": "unavailable"
            }));
        }
    };

    let end_time = query.end.as_ref()
        .map(|s| parse_iso8601_time(s))
        .unwrap_or_else(|| Ok(Utc::now()));
    
    let end_time = match end_time {
        Ok(t) => t,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("结束时间格式错误: {}", e),
                "hint": "请使用 ISO 8601 格式，如: 2024-01-15T10:00:00Z"
            }));
        }
    };

    let start_time = query.start.as_ref()
        .map(|s| parse_iso8601_time(s))
        .unwrap_or_else(|| Ok(end_time - chrono::Duration::hours(24)));
    
    let start_time = match start_time {
        Ok(t) => t,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("开始时间格式错误: {}", e),
                "hint": "请使用 ISO 8601 格式，如: 2024-01-15T10:00:00Z"
            }));
        }
    };

    if start_time > end_time {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "开始时间不能晚于结束时间"
        }));
    }

    let limit = query.limit.unwrap_or(100).min(1000);
    let log_level = query.level.as_ref().map(|s| s.as_str());

    debug!("查询错误日志: start={}, end={}, level={:?}, limit={}", 
           start_time, end_time, log_level, limit);

    match es_client.query_error_logs(&start_time, &end_time, log_level, limit).await {
        Ok(results) => {
            HttpResponse::Ok().json(serde_json::json!({
                "status": "ok",
                "count": results.len(),
                "time_range": {
                    "start": start_time.to_rfc3339(),
                    "end": end_time.to_rfc3339()
                },
                "logs": results
            }))
        }
        Err(e) => {
            error!("查询错误日志失败: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("查询失败: {}", e),
                "status": "error"
            }))
        }
    }
}

#[get("/api/logs/stats")]
async fn get_log_stats(
    es_client: web::Data<Option<ElasticsearchClient>>,
    query: web::Query<LogQueryParams>,
) -> impl Responder {
    let es_client = match es_client.get_ref() {
        Some(client) => client,
        None => {
            return HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "error": "Elasticsearch 未配置",
                "status": "unavailable"
            }));
        }
    };

    let end_time = query.end.as_ref()
        .map(|s| parse_iso8601_time(s))
        .unwrap_or_else(|| Ok(Utc::now()));
    
    let end_time = match end_time {
        Ok(t) => t,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("结束时间格式错误: {}", e),
                "hint": "请使用 ISO 8601 格式，如: 2024-01-15T10:00:00Z"
            }));
        }
    };

    let start_time = query.start.as_ref()
        .map(|s| parse_iso8601_time(s))
        .unwrap_or_else(|| Ok(end_time - chrono::Duration::hours(24)));
    
    let start_time = match start_time {
        Ok(t) => t,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("开始时间格式错误: {}", e),
                "hint": "请使用 ISO 8601 格式，如: 2024-01-15T10:00:00Z"
            }));
        }
    };

    match es_client.get_error_stats(&start_time, &end_time).await {
        Ok(stats) => {
            HttpResponse::Ok().json(serde_json::json!({
                "status": "ok",
                "stats": stats
            }))
        }
        Err(e) => {
            error!("获取日志统计失败: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("获取统计失败: {}", e),
                "status": "error"
            }))
        }
    }
}

async fn es_health_check(
    es_client: web::Data<Option<ElasticsearchClient>>,
) -> impl Responder {
    if let Some(client) = es_client.get_ref() {
        match client.health_check().await {
            Ok(true) => HttpResponse::Ok().json(serde_json::json!({
                "status": "ok",
                "elasticsearch": "connected"
            })),
            Ok(false) => HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "status": "error",
                "elasticsearch": "unhealthy"
            })),
            Err(e) => HttpResponse::ServiceUnavailable().json(serde_json::json!({
                "status": "error",
                "elasticsearch": format!("{}", e)
            })),
        }
    } else {
        HttpResponse::Ok().json(serde_json::json!({
            "status": "ok",
            "elasticsearch": "not_configured"
        }))
    }
}

async fn start_http_server(
    config: AppConfig,
    es_client: Option<ElasticsearchClient>,
) -> std::io::Result<()> {
    info!("启动 HTTP 服务器，端口: {}", config.http_port);
    
    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(es_client.clone()))
            .service(
                web::scope("/api")
                    .service(query_error_logs)
                    .service(get_log_stats)
            )
            .route("/health", web::get().to(health_check))
            .route("/health/es", web::get().to(es_health_check))
    })
    .bind(("0.0.0.0", config.http_port))?
    .run()
    .await
}

async fn start_grpc_server(
    config: AppConfig,
    es_client: Option<ElasticsearchClient>,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("0.0.0.0:{}", config.grpc_port).parse()?;
    info!("启动 gRPC 服务器，地址: {}", addr);

    let log_service = LogServiceImpl::new(es_client);

    TonicServer::builder()
        .add_service(LogServiceServer::new(log_service))
        .serve(addr)
        .await?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    info!("启动日志收集器后端服务");

    let config = AppConfig::default();

    let es_url = env::var("ELASTICSEARCH_URL")
        .unwrap_or_else(|_| config.es_url.clone());
    
    let es_index_prefix = env::var("ELASTICSEARCH_INDEX_PREFIX")
        .unwrap_or_else(|_| config.es_index_prefix.clone());

    let es_client = match ElasticsearchClient::new(&es_url, &es_index_prefix).await {
        Ok(client) => {
            info!("Elasticsearch 客户端初始化成功: {}", es_url);
            Some(client)
        }
        Err(e) => {
            warn!("Elasticsearch 客户端初始化失败: {}", e);
            warn!("将以无 Elasticsearch 模式运行");
            None
        }
    };

    let http_config = AppConfig {
        http_port: env::var("HTTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(config.http_port),
        grpc_port: env::var("GRPC_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(config.grpc_port),
        es_url: es_url.clone(),
        es_index_prefix: es_index_prefix.clone(),
    };

    let grpc_config = http_config.clone();
    let grpc_es_client = es_client.clone();

    let http_handle = tokio::spawn(async move {
        if let Err(e) = start_http_server(http_config, es_client).await {
            error!("HTTP 服务器错误: {}", e);
        }
    });

    let grpc_handle = tokio::spawn(async move {
        if let Err(e) = start_grpc_server(grpc_config, grpc_es_client).await {
            error!("gRPC 服务器错误: {}", e);
        }
    });

    info!("服务启动完成");
    info!("HTTP 端点: http://localhost:{}/health", http_config.http_port);
    info!("gRPC 端点: localhost:{}", http_config.grpc_port);

    let _ = tokio::join!(http_handle, grpc_handle);

    Ok(())
}
