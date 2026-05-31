use common::{ParsedLogEntry, LogError};
use elasticsearch::{
    Elasticsearch,
    http::transport::{Transport, SingleNodeConnectionPool},
    IndexParts,
    indices::IndicesCreateParts,
};
use serde_json::json;
use std::sync::Arc;
use tracing::{info, error, warn, debug};

#[derive(Clone)]
pub struct ElasticsearchClient {
    client: Arc<Elasticsearch>,
    index_prefix: String,
}

impl ElasticsearchClient {
    pub async fn new(es_url: &str, index_prefix: &str) -> Result<Self, LogError> {
        let url = url::Url::parse(es_url)
            .map_err(|e| LogError::ElasticsearchError(format!("URL解析失败: {}", e)))?;
        
        let conn_pool = SingleNodeConnectionPool::new(url);
        let transport = Transport::new(conn_pool)
            .map_err(|e| LogError::ElasticsearchError(format!("创建传输失败: {}", e)))?;
        
        let client = Elasticsearch::new(transport);
        
        let es_client = Self {
            client: Arc::new(client),
            index_prefix: index_prefix.to_string(),
        };
        
        es_client.create_index_template().await?;
        
        Ok(es_client)
    }
    
    async fn create_index_template(&self) -> Result<(), LogError> {
        let template_name = format!("{}_template", self.index_prefix);
        let index_pattern = format!("{}*", self.index_prefix);
        
        let template = json!({
            "index_patterns": [index_pattern],
            "template": {
                "mappings": {
                    "properties": {
                        "server_name": {
                            "type": "keyword"
                        },
                        "file_path": {
                            "type": "keyword"
                        },
                        "content": {
                            "type": "text",
                            "fields": {
                                "keyword": {
                                    "type": "keyword",
                                    "ignore_above": 256
                                }
                            }
                        },
                        "timestamp": {
                            "type": "date"
                        },
                        "log_level": {
                            "type": "keyword"
                        },
                        "log_type": {
                            "type": "keyword"
                        },
                        "received_at": {
                            "type": "date"
                        },
                        "metadata": {
                            "type": "object",
                            "dynamic": true
                        }
                    }
                },
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "refresh_interval": "5s"
                }
            },
            "priority": 100,
            "version": 1,
            "template": "index template for logs"
        });
        
        let response = self.client
            .indices()
            .put_index_template(elasticsearch::indices::IndicesPutIndexTemplateParts::Name(&template_name))
            .body(template)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("创建索引模板失败: {}", e)))?;
        
        if response.status_code().is_success() {
            info!("成功创建/更新索引模板: {}", template_name);
            Ok(())
        } else {
            let error_body = response.json::<serde_json::Value>()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
            
            warn!("创建索引模板返回非成功状态码: {}", 
                  serde_json::to_string_pretty(&error_body).unwrap_or_default());
            Ok(())
        }
    }
    
    async fn ensure_index_exists(&self, index_name: &str) -> Result<(), LogError> {
        let exists_response = self.client
            .indices()
            .exists(elasticsearch::indices::IndicesExistsParts::Index(&[index_name]))
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("检查索引存在性失败: {}", e)))?;
        
        if !exists_response.status_code().is_success() {
            debug!("索引 {} 不存在，正在创建...", index_name);
            
            let create_response = self.client
                .indices()
                .create(IndicesCreateParts::Index(index_name))
                .send()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("创建索引失败: {}", e)))?;
            
            if !create_response.status_code().is_success() {
                let error_body = create_response.json::<serde_json::Value>()
                    .await
                    .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
                
                return Err(LogError::ElasticsearchError(
                    format!("创建索引失败: {}", serde_json::to_string_pretty(&error_body).unwrap_or_default())
                ));
            }
            
            info!("成功创建索引: {}", index_name);
        }
        
        Ok(())
    }

    fn get_index_name(&self) -> String {
        let now = chrono::Utc::now();
        format!("{}-{}", self.index_prefix, now.format("%Y.%m.%d"))
    }

    pub async fn store_log(&self, entry: &ParsedLogEntry) -> Result<(), LogError> {
        let index_name = self.get_index_name();
        self.ensure_index_exists(&index_name).await?;
        
        let doc = json!({
            "server_name": entry.server_name,
            "file_path": entry.file_path,
            "content": entry.content,
            "timestamp": entry.timestamp,
            "log_level": entry.log_level.to_string(),
            "log_type": entry.log_type,
            "metadata": entry.metadata,
            "received_at": chrono::Utc::now(),
        });

        let response = self.client
            .index(IndexParts::Index(&index_name))
            .body(doc)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("索引请求失败: {}", e)))?;

        if response.status_code().is_success() {
            info!("成功存储日志到 Elasticsearch，索引: {}", index_name);
            Ok(())
        } else {
            let error_body = response.json::<serde_json::Value>()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
            
            Err(LogError::ElasticsearchError(
                format!("Elasticsearch 错误: {}", serde_json::to_string_pretty(&error_body).unwrap_or_default())
            ))
        }
    }

    pub async fn bulk_store_logs(&self, entries: &[ParsedLogEntry]) -> Result<usize, LogError> {
        if entries.is_empty() {
            return Ok(0);
        }

        let index_name = self.get_index_name();
        self.ensure_index_exists(&index_name).await?;
        
        let mut bulk_body: Vec<serde_json::Value> = Vec::new();

        for entry in entries {
            bulk_body.push(json!({
                "index": { "_index": index_name }
            }));
            
            bulk_body.push(json!({
                "server_name": entry.server_name,
                "file_path": entry.file_path,
                "content": entry.content,
                "timestamp": entry.timestamp,
                "log_level": entry.log_level.to_string(),
                "log_type": entry.log_type,
                "metadata": entry.metadata,
                "received_at": chrono::Utc::now(),
            }));
        }

        let response = self.client
            .bulk(elasticsearch::BulkParts::None)
            .body(bulk_body)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("批量请求失败: {}", e)))?;

        if response.status_code().is_success() {
            let response_body = response.json::<serde_json::Value>()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
            
            let errors = response_body.get("errors").and_then(|v| v.as_bool()).unwrap_or(true);
            
            if !errors {
                info!("成功批量存储 {} 条日志到 Elasticsearch", entries.len());
                Ok(entries.len())
            } else {
                warn!("批量存储部分日志失败");
                let items = response_body.get("items").and_then(|v| v.as_array());
                let success_count = items.map(|items| {
                    items.iter().filter(|item| {
                        item.get("index")
                            .and_then(|idx| idx.get("status"))
                            .and_then(|s| s.as_i64())
                            .map(|s| s >= 200 && s < 300)
                            .unwrap_or(false)
                    }).count()
                }).unwrap_or(0);
                
                Ok(success_count)
            }
        } else {
            let error_body = response.json::<serde_json::Value>()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
            
            Err(LogError::ElasticsearchError(
                format!("Elasticsearch 批量错误: {}", serde_json::to_string_pretty(&error_body).unwrap_or_default())
            ))
        }
    }

    pub async fn health_check(&self) -> Result<bool, LogError> {
        let response = self.client
            .cluster()
            .health(elasticsearch::ClusterHealthParts::None)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("健康检查失败: {}", e)))?;
        
        Ok(response.status_code().is_success())
    }

    pub async fn query_error_logs(
        &self,
        start_time: &chrono::DateTime<chrono::Utc>,
        end_time: &chrono::DateTime<chrono::Utc>,
        log_level: Option<&str>,
        limit: usize,
    ) -> Result<Vec<serde_json::Value>, LogError> {
        let start_str = start_time.format("%Y.%m.%d").to_string();
        let end_str = end_time.format("%Y.%m.%d").to_string();
        
        let mut index_patterns = Vec::new();
        let mut current = start_time.date_naive();
        let end_date = end_time.date_naive();
        
        while current <= end_date {
            let idx = format!("{}-{}", self.index_prefix, current.format("%Y.%m.%d"));
            index_patterns.push(idx);
            current += chrono::Duration::days(1);
        }
        
        if index_patterns.is_empty() {
            return Ok(Vec::new());
        }
        
        let indices: Vec<&str> = index_patterns.iter().map(|s| s.as_str()).collect();
        
        let mut must_conditions = vec![
            json!({
                "range": {
                    "timestamp": {
                        "gte": start_time.to_rfc3339(),
                        "lte": end_time.to_rfc3339(),
                        "format": "date_time"
                    }
                }
            })
        ];
        
        if let Some(level) = log_level {
            must_conditions.push(json!({
                "term": {
                    "log_level": level
                }
            }));
        } else {
            must_conditions.push(json!({
                "terms": {
                    "log_level": ["ERROR", "WARN"]
                }
            }));
        }
        
        let query = json!({
            "query": {
                "bool": {
                    "must": must_conditions
                }
            },
            "sort": [
                { "timestamp": { "order": "desc" } }
            ],
            "size": limit
        });
        
        let response = self.client
            .search(elasticsearch::SearchParts::Index(&indices))
            .body(query)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("查询失败: {}", e)))?;
        
        if !response.status_code().is_success() {
            let error_body = response.json::<serde_json::Value>()
                .await
                .map_err(|e| LogError::ElasticsearchError(format!("读取响应失败: {}", e)))?;
            
            return Err(LogError::ElasticsearchError(
                format!("查询错误: {}", serde_json::to_string_pretty(&error_body).unwrap_or_default())
            ));
        }
        
        let response_body = response.json::<serde_json::Value>()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("解析响应失败: {}", e)))?;
        
        let hits = response_body
            .get("hits")
            .and_then(|h| h.get("hits"))
            .and_then(|h| h.as_array())
            .unwrap_or(&Vec::new());
        
        let results: Vec<serde_json::Value> = hits
            .iter()
            .filter_map(|hit| hit.get("_source").cloned())
            .collect();
        
        Ok(results)
    }

    pub async fn get_error_stats(
        &self,
        start_time: &chrono::DateTime<chrono::Utc>,
        end_time: &chrono::DateTime<chrono::Utc>,
    ) -> Result<serde_json::Value, LogError> {
        let start_str = start_time.format("%Y.%m.%d").to_string();
        let end_str = end_time.format("%Y.%m.%d").to_string();
        
        let mut index_patterns = Vec::new();
        let mut current = start_time.date_naive();
        let end_date = end_time.date_naive();
        
        while current <= end_date {
            let idx = format!("{}-{}", self.index_prefix, current.format("%Y.%m.%d"));
            index_patterns.push(idx);
            current += chrono::Duration::days(1);
        }
        
        if index_patterns.is_empty() {
            return Ok(json!({
                "total": 0,
                "by_level": {},
                "by_server": {}
            }));
        }
        
        let indices: Vec<&str> = index_patterns.iter().map(|s| s.as_str()).collect();
        
        let query = json!({
            "query": {
                "bool": {
                    "must": [
                        {
                            "range": {
                                "timestamp": {
                                    "gte": start_time.to_rfc3339(),
                                    "lte": end_time.to_rfc3339(),
                                    "format": "date_time"
                                }
                            }
                        },
                        {
                            "terms": {
                                "log_level": ["ERROR", "WARN"]
                            }
                        }
                    ]
                }
            },
            "size": 0,
            "aggs": {
                "by_level": {
                    "terms": { "field": "log_level" }
                },
                "by_server": {
                    "terms": { "field": "server_name" }
                }
            }
        });
        
        let response = self.client
            .search(elasticsearch::SearchParts::Index(&indices))
            .body(query)
            .send()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("统计查询失败: {}", e)))?;
        
        let response_body = response.json::<serde_json::Value>()
            .await
            .map_err(|e| LogError::ElasticsearchError(format!("解析响应失败: {}", e)))?;
        
        let total = response_body
            .get("hits")
            .and_then(|h| h.get("total"))
            .and_then(|t| t.get("value"))
            .cloned()
            .unwrap_or(json!(0));
        
        let by_level = response_body
            .get("aggregations")
            .and_then(|a| a.get("by_level"))
            .and_then(|a| a.get("buckets"))
            .cloned()
            .unwrap_or(json!([]));
        
        let by_server = response_body
            .get("aggregations")
            .and_then(|a| a.get("by_server"))
            .and_then(|a| a.get("buckets"))
            .cloned()
            .unwrap_or(json!([]));
        
        Ok(json!({
            "total": total,
            "by_level": by_level,
            "by_server": by_server,
            "time_range": {
                "start": start_time.to_rfc3339(),
                "end": end_time.to_rfc3339()
            }
        }))
    }
}
