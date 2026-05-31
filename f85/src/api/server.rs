use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::sctp::association::{AssociationConfigParams, AssociationManager};
use crate::mapping::stream_mapper::StreamMapper;
use crate::multipath::path_manager::{PathHealthStats, PathHealthStatus, PathManager};
use crate::qos::queue::{QoSManager, QoSPolicy};
use crate::stats::collector::StatsCollector;
use crate::types::*;

#[derive(Clone)]
pub struct ApiState {
    pub association_manager: Arc<RwLock<AssociationManager>>,
    pub stream_mapper: Arc<RwLock<StreamMapper>>,
    pub path_manager: Arc<RwLock<PathManager>>,
    pub qos_manager: Arc<RwLock<QoSManager>>,
    pub stats: Arc<StatsCollector>,
}

pub async fn start_api_server(
    listen_addr: SocketAddr,
    state: ApiState,
) -> Result<(), std::io::Error> {
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/associations", get(list_associations).post(create_association))
        .route(
            "/api/v1/associations/{id}",
            get(get_association).delete(delete_association),
        )
        .route(
            "/api/v1/associations/{id}/streams",
            get(list_streams).post(add_stream),
        )
        .route(
            "/api/v1/associations/{id}/streams/{stream_id}",
            get(get_stream).delete(delete_stream),
        )
        .route("/api/v1/stats", get(get_global_stats))
        .route("/api/v1/stats/associations", get(get_all_association_stats))
        .route(
            "/api/v1/stats/associations/{id}",
            get(get_association_stats),
        )
        .route(
            "/api/v1/stats/streams/{stream_id}",
            get(get_stream_stats),
        )
        .route("/api/v1/paths", get(list_paths))
        .route("/api/v1/paths/{name}", get(get_path_stats))
        .route("/api/v1/qos", get(get_qos_stats))
        .route("/api/v1/qos/streams/{stream_id}", get(get_stream_qos_stats))
        .route(
            "/api/v1/stats/associations/{id}/reordering",
            get(get_reordering_stats),
        )
        .route(
            "/api/v1/stats/reordering/all",
            get(get_all_reordering_stats),
        )
        .route("/api/v1/paths/health", get(get_all_path_health))
        .route("/api/v1/paths/{name}/health", get(get_path_health))
        .route(
            "/api/v1/paths/{name}/health/force-recover",
            post(force_path_recovery),
        )
        .route(
            "/api/v1/paths/{name}/health/force-fail",
            post(force_path_failure),
        )
        .route(
            "/api/v1/paths/{name}/health/thresholds",
            post(set_path_thresholds),
        )
        .route("/api/v1/paths/migrations", get(get_migration_stats))
        .with_state(state);

    info!(addr = %listen_addr, "Starting API server");

    let listener = tokio::net::TcpListener::bind(listen_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn list_associations(
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let manager = state.association_manager.read();
    let ids = manager.all_associations();
    Json(ids)
}

async fn create_association(
    State(state): State<ApiState>,
    Json(request): Json<CreateAssociationRequest>,
) -> impl IntoResponse {
    let local_addr = match request.local_addr.parse::<SocketAddr>() {
        Ok(addr) => addr,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::<AssociationStats>::error(format!(
                    "Invalid local_addr: {}",
                    e
                ))),
            )
                .into_response();
        }
    };

    let remote_addr = match request.remote_addr.parse::<SocketAddr>() {
        Ok(addr) => addr,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::<AssociationStats>::error(format!(
                    "Invalid remote_addr: {}",
                    e
                ))),
            )
                .into_response();
        }
    };

    let stream_configs: Result<Vec<StreamConfig>, String> = request
        .streams
        .iter()
        .map(|s| {
            let backend_addr = s.backend_addr.parse::<SocketAddr>().map_err(|e| e.to_string())?;
            Ok(StreamConfig {
                stream_id: s.stream_id,
                backend_addr,
                qos: QoSConfig {
                    priority: s.priority.unwrap_or(5),
                    bandwidth_limit_bps: s.bandwidth_limit_bps,
                },
            })
        })
        .collect();

    let stream_configs = match stream_configs {
        Ok(configs) => configs,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiResponse::<AssociationStats>::error(format!(
                    "Invalid stream config: {}",
                    e
                ))),
            )
                .into_response();
        }
    };

    let config = AssociationConfigParams {
        assoc_id: request.assoc_id,
        local_addr,
        remote_addr,
        init_tag: rand::random(),
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: rand::random(),
        stream_configs: stream_configs.clone(),
    };

    let mut manager = state.association_manager.write();
    manager.create_association(config);
    drop(manager);

    state.stats.register_association(request.assoc_id);

    for stream_config in &stream_configs {
        state.stats.register_stream(
            request.assoc_id,
            stream_config.stream_id,
            stream_config.backend_addr.to_string(),
        );
    }

    {
        let mut mapper = state.stream_mapper.write();
        for stream_config in &stream_configs {
            let _ = mapper.add_stream_mapping(
                stream_config.stream_id,
                stream_config.backend_addr,
            );
        }
    }

    {
        let mut qos = state.qos_manager.write();
        for stream_config in &stream_configs {
            qos.register_stream(QoSPolicy {
                stream_id: stream_config.stream_id,
                priority: stream_config.qos.priority,
                bandwidth_limit_bps: stream_config.qos.bandwidth_limit_bps,
                max_queue_size: 4096,
            });
        }
    }

    info!(assoc_id = %request.assoc_id, "Created association via API");

    let stats = state
        .stats
        .get_association_stats(request.assoc_id, AssociationState::Closed);

    (StatusCode::OK, Json(ApiResponse::success(stats))).into_response()
}

async fn get_association(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
) -> impl IntoResponse {
    let stats = state
        .stats
        .get_association_stats(id, AssociationState::Closed);

    if stats.total_packets_sent > 0
        || stats.total_packets_received > 0
        || stats.stream_stats.len() > 0
    {
        Json(ApiResponse::success(stats))
    } else {
        let manager = state.association_manager.read();
        match manager.get_stats(id) {
            Some(s) => Json(ApiResponse::success(s)),
            None => Json(ApiResponse::error("Association not found")),
        }
    }
}

async fn delete_association(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
) -> impl IntoResponse {
    {
        let mut manager = state.association_manager.write();
        manager.remove_association(id);
    }

    state.stats.unregister_association(id);

    info!(assoc_id = %id, "Deleted association via API");

    Json(ApiResponse::<()>::success(()))
}

async fn list_streams(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
) -> impl IntoResponse {
    let manager = state.association_manager.read();
    match manager.get_association(id) {
        Some(tcb) => {
            let tcb = tcb.read();
            let stream_ids: Vec<StreamId> = tcb.stream_seq_map.keys().copied().collect();
            Json(ApiResponse::success(stream_ids))
        }
        None => Json(ApiResponse::error("Association not found")),
    }
}

async fn add_stream(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
    Json(request): Json<StreamMappingRequest>,
) -> impl IntoResponse {
    let backend_addr = match request.backend_addr.parse::<SocketAddr>() {
        Ok(addr) => addr,
        Err(e) => {
            return Json(ApiResponse::<()>::error(format!(
                "Invalid backend_addr: {}",
                e
            )));
        }
    };

    {
        let mut mapper = state.stream_mapper.write();
        if let Err(e) = mapper.add_stream_mapping(request.stream_id, backend_addr) {
            return Json(ApiResponse::error(e.to_string()));
        }
    }

    state
        .stats
        .register_stream(id, request.stream_id, request.backend_addr.clone());

    {
        let mut qos = state.qos_manager.write();
        qos.register_stream(QoSPolicy {
            stream_id: request.stream_id,
            priority: request.priority.unwrap_or(5),
            bandwidth_limit_bps: request.bandwidth_limit_bps,
            max_queue_size: 4096,
        });
    }

    info!(assoc_id = %id, stream_id = %request.stream_id, "Added stream via API");

    Json(ApiResponse::<()>::success(()))
}

async fn get_stream(
    State(state): State<ApiState>,
    Path((id, stream_id)): Path<(AssociationId, StreamId)>,
) -> impl IntoResponse {
    let mapper = state.stream_mapper.read();
    match mapper.get_stream_stats(stream_id) {
        Some(stats) => Json(ApiResponse::success(stats)),
        None => Json(ApiResponse::error("Stream not found")),
    }
}

async fn delete_stream(
    State(state): State<ApiState>,
    Path((id, stream_id)): Path<(AssociationId, StreamId)>,
) -> impl IntoResponse {
    {
        let mut mapper = state.stream_mapper.write();
        if let Err(e) = mapper.remove_stream_mapping(stream_id) {
            return Json(ApiResponse::<()>::error(e.to_string()));
        }
    }

    {
        let mut qos = state.qos_manager.write();
        qos.remove_stream(stream_id);
    }

    info!(assoc_id = %id, stream_id = %stream_id, "Deleted stream via API");

    Json(ApiResponse::<()>::success(()))
}

async fn get_global_stats(State(state): State<ApiState>) -> impl IntoResponse {
    let stats = state.stats.get_global_stats();
    Json(ApiResponse::success(stats))
}

async fn get_all_association_stats(State(state): State<ApiState>) -> impl IntoResponse {
    let stats = state.stats.get_all_association_stats();
    Json(ApiResponse::success(stats))
}

async fn get_association_stats(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
) -> impl IntoResponse {
    let stats = state
        .stats
        .get_association_stats(id, AssociationState::Closed);
    Json(ApiResponse::success(stats))
}

async fn get_stream_stats(
    State(state): State<ApiState>,
    Path(stream_id): Path<StreamId>,
) -> impl IntoResponse {
    let mapper = state.stream_mapper.read();
    match mapper.get_stream_stats(stream_id) {
        Some(stats) => Json(ApiResponse::success(stats)),
        None => Json(ApiResponse::error("Stream not found")),
    }
}

async fn list_paths(State(state): State<ApiState>) -> impl IntoResponse {
    let path_manager = state.path_manager.read();
    let stats = path_manager.all_path_stats();
    Json(ApiResponse::success(stats))
}

async fn get_path_stats(
    State(state): State<ApiState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let path_manager = state.path_manager.read();
    match path_manager.get_path_stats(&name) {
        Some(stats) => Json(ApiResponse::success(stats)),
        None => Json(ApiResponse::error("Path not found")),
    }
}

async fn get_qos_stats(State(state): State<ApiState>) -> impl IntoResponse {
    let qos = state.qos_manager.read();
    let stats = qos.get_stats();
    Json(ApiResponse::success(stats))
}

async fn get_stream_qos_stats(
    State(state): State<ApiState>,
    Path(stream_id): Path<StreamId>,
) -> impl IntoResponse {
    let qos = state.qos_manager.read();
    match qos.get_stream_stats(stream_id) {
        Some(stats) => Json(ApiResponse::success(stats)),
        None => Json(ApiResponse::error("Stream not found")),
    }
}

async fn get_reordering_stats(
    State(state): State<ApiState>,
    Path(id): Path<AssociationId>,
) -> impl IntoResponse {
    let manager = state.association_manager.read();
    match manager.get_association(id) {
        Some(tcb) => {
            let stats = tcb.read().get_reordering_stats();
            let response = crate::types::ReorderingStatsResponse {
                total_packets: stats.total_packets,
                out_of_order_packets: stats.out_of_order_packets,
                reorder_rate: stats.reorder_rate(),
                max_reorder_gap: stats.max_reorder_gap,
                avg_reorder_gap: stats.avg_reorder_gap,
                reorder_events: stats.reorder_events,
                forward_tsn_count: stats.forward_tsn_count,
                avg_reorder_delay_ms: stats.avg_reorder_delay_ms(),
            };
            Json(ApiResponse::success(response))
        }
        None => Json(ApiResponse::error("Association not found")),
    }
}

async fn get_all_reordering_stats(
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let manager = state.association_manager.read();
    let ids = manager.all_associations();
    let mut all_stats = std::collections::HashMap::new();

    for id in ids {
        if let Some(tcb) = manager.get_association(id) {
            let stats = tcb.read().get_reordering_stats();
            let response = crate::types::ReorderingStatsResponse {
                total_packets: stats.total_packets,
                out_of_order_packets: stats.out_of_order_packets,
                reorder_rate: stats.reorder_rate(),
                max_reorder_gap: stats.max_reorder_gap,
                avg_reorder_gap: stats.avg_reorder_gap,
                reorder_events: stats.reorder_events,
                forward_tsn_count: stats.forward_tsn_count,
                avg_reorder_delay_ms: stats.avg_reorder_delay_ms(),
            };
            all_stats.insert(id, response);
        }
    }

    Json(ApiResponse::success(all_stats))
}

async fn get_all_path_health(
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    let stats = pm.get_all_health_stats();
    Json(ApiResponse::success(stats))
}

async fn get_path_health(
    State(state): State<ApiState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    match pm.get_path_health_stats(&name) {
        Some(stats) => Json(ApiResponse::success(stats)),
        None => Json(ApiResponse::error("Path not found")),
    }
}

#[derive(Debug, Deserialize)]
struct ThresholdUpdate {
    max_rtt_ms: Option<u64>,
    max_loss_rate: Option<f64>,
}

async fn set_path_thresholds(
    State(state): State<ApiState>,
    Path(name): Path<String>,
    Json(update): Json<ThresholdUpdate>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    match pm.set_path_health_thresholds(&name, update.max_rtt_ms, update.max_loss_rate) {
        Ok(()) => Json(ApiResponse::success(serde_json::json!({
            "message": "Thresholds updated"
        }))),
        Err(e) => Json(ApiResponse::error(&e.to_string())),
    }
}

async fn force_path_recovery(
    State(state): State<ApiState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    match pm.force_path_recovery(&name) {
        Ok(()) => Json(ApiResponse::success(serde_json::json!({
            "message": "Path forcefully recovered"
        }))),
        Err(e) => Json(ApiResponse::error(&e.to_string())),
    }
}

async fn force_path_failure(
    State(state): State<ApiState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    match pm.force_path_failure(&name) {
        Ok(()) => Json(ApiResponse::success(serde_json::json!({
            "message": "Path forcefully failed, flows migrated"
        }))),
        Err(e) => Json(ApiResponse::error(&e.to_string())),
    }
}

async fn get_migration_stats(
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let pm = state.path_manager.read();
    let (total, failed) = pm.migration_stats();
    Json(ApiResponse::success(serde_json::json!({
        "total_migrations": total,
        "failed_path_migrations": failed
    })))
}
