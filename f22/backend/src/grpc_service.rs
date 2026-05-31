use common::log_service::{
    log_service_server::LogService,
    LogEntry,
    SendLogEntriesRequest,
    SendLogEntriesResponse,
    StreamLogEntriesResponse,
};
use crate::parser::parse_log_entry;
use crate::elasticsearch::ElasticsearchClient;
use std::sync::Arc;
use tonic::{Request, Response, Status};
use tracing::{info, error, warn};

#[derive(Clone)]
pub struct LogServiceImpl {
    es_client: Option<Arc<ElasticsearchClient>>,
}

impl LogServiceImpl {
    pub fn new(es_client: Option<ElasticsearchClient>) -> Self {
        Self {
            es_client: es_client.map(Arc::new),
        }
    }
}

#[tonic::async_trait]
impl LogService for LogServiceImpl {
    async fn send_log_entries(
        &self,
        request: Request<SendLogEntriesRequest>,
    ) -> Result<Response<SendLogEntriesResponse>, Status> {
        let request = request.into_inner();
        info!("收到日志发送请求，共 {} 条日志", request.entries.len());

        let mut error_count = 0;
        let mut parsed_entries = Vec::new();

        for entry in &request.entries {
            match parse_log_entry(
                &entry.server_name,
                &entry.file_path,
                &entry.content,
                entry.timestamp,
                &entry.log_type,
            ) {
                Ok(Some(parsed)) => {
                    info!("解析到 {} 级别日志: {}", parsed.log_level, 
                          if parsed.content.len() > 100 {
                              format!("{}...", &parsed.content[..100])
                          } else {
                              parsed.content.clone()
                          });
                    parsed_entries.push(parsed);
                }
                Ok(None) => {
                    // INFO/DEBUG 级别日志，不存储
                }
                Err(e) => {
                    error!("解析日志失败: {}", e);
                    error_count += 1;
                }
            }
        }

        let stored_count = if let Some(es_client) = &self.es_client {
            match es_client.bulk_store_logs(&parsed_entries).await {
                Ok(count) => count,
                Err(e) => {
                    error!("存储日志到 Elasticsearch 失败: {}", e);
                    0
                }
            }
        } else {
            warn!("未配置 Elasticsearch，跳过存储");
            parsed_entries.len()
        };

        let response = SendLogEntriesResponse {
            success: error_count == 0,
            received_count: request.entries.len() as i32,
            message: format!("成功接收 {} 条日志，存储 {} 条错误/警告日志", 
                           request.entries.len(), stored_count),
        };

        Ok(Response::new(response))
    }

    async fn stream_log_entries(
        &self,
        request: Request<tonic::Streaming<LogEntry>>,
    ) -> Result<Response<StreamLogEntriesResponse>, Status> {
        let mut stream = request.into_inner();
        let mut count = 0;
        let mut parsed_entries = Vec::new();

        while let Some(entry) = stream.message().await? {
            count += 1;
            
            match parse_log_entry(
                &entry.server_name,
                &entry.file_path,
                &entry.content,
                entry.timestamp,
                &entry.log_type,
            ) {
                Ok(Some(parsed)) => {
                    parsed_entries.push(parsed);
                }
                Ok(None) => {}
                Err(e) => {
                    error!("解析日志失败: {}", e);
                }
            }
        }

        let stored_count = if let Some(es_client) = &self.es_client {
            match es_client.bulk_store_logs(&parsed_entries).await {
                Ok(count) => count,
                Err(e) => {
                    error!("存储日志到 Elasticsearch 失败: {}", e);
                    0
                }
            }
        } else {
            parsed_entries.len()
        };

        info!("流式接收完成，共 {} 条日志，存储 {} 条", count, stored_count);

        let response = StreamLogEntriesResponse {
            success: true,
            received_count: count as i32,
            message: format!("流式接收完成，共 {} 条日志", count),
        };

        Ok(Response::new(response))
    }
}
