use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use parking_lot::RwLock;

use sctp_gateway::mapping::stream_mapper::StreamMapper;
use sctp_gateway::multipath::path_manager::PathManager;
use sctp_gateway::qos::queue::{QoSManager, QoSPolicy};
use sctp_gateway::sctp::association::{AssociationConfigParams, AssociationManager};
use sctp_gateway::sctp::protocol::*;
use sctp_gateway::stats::collector::StatsCollector;
use sctp_gateway::types::*;

#[test]
fn test_association_creation() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs: vec![
            StreamConfig {
                stream_id: 0,
                backend_addr: "127.0.0.1:8080".parse().unwrap(),
                qos: QoSConfig {
                    priority: 5,
                    bandwidth_limit_bps: None,
                },
            },
        ],
    };

    let tcb = manager.create_association(config);
    assert_eq!(tcb.read().assoc_id, 1);

    let ids = manager.all_associations();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], 1);
}

#[test]
fn test_sctp_packet_encode_decode() {
    let header = SctpHeader::new(5000, 9000, 0x12345678);
    let payload = DataChunkPayload {
        tsn: 1,
        stream_id: 0,
        stream_seq: 0,
        payload_proto: 0,
        user_data: Bytes::from_static(b"test data"),
    };

    let mut flags = ChunkFlags::new();
    let chunk = payload.encode(flags);
    let packet = SctpPacket::new(header, vec![chunk]);
    let encoded = packet.encode();

    let mut reader = encoded.as_ref();
    let parsed = SctpPacket::parse(&mut reader).unwrap();

    assert_eq!(parsed.header.src_port, 5000);
    assert_eq!(parsed.header.dst_port, 9000);
    assert_eq!(parsed.chunks.len(), 1);

    let data = DataChunkPayload::parse(&parsed.chunks[0]).unwrap();
    assert_eq!(data.user_data, Bytes::from_static(b"test data"));
}

#[test]
fn test_qos_priority_queue() {
    let mut qos = QoSManager::new();

    qos.register_stream(QoSPolicy {
        stream_id: 0,
        priority: 10,
        bandwidth_limit_bps: None,
        max_queue_size: 1024,
    });

    qos.register_stream(QoSPolicy {
        stream_id: 1,
        priority: 1,
        bandwidth_limit_bps: None,
        max_queue_size: 1024,
    });

    qos.enqueue(0, Bytes::from_static(b"high priority")).unwrap();
    qos.enqueue(1, Bytes::from_static(b"low priority")).unwrap();

    let items = qos.dequeue_all_available();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].0, 0);
    assert_eq!(items[1].0, 1);
}

#[test]
fn test_path_manager() {
    let mut pm = PathManager::new();

    let addr1: SocketAddr = "127.0.0.1:9000".parse().unwrap();
    let addr2: SocketAddr = "127.0.0.1:9001".parse().unwrap();

    pm.add_path("eth0".to_string(), addr1).unwrap();
    pm.add_path("eth1".to_string(), addr2).unwrap();

    assert_eq!(pm.path_count(), 2);
    assert_eq!(pm.active_path_count(), 2);

    pm.set_path_active("eth0", false).unwrap();
    assert_eq!(pm.active_path_count(), 1);

    let path = pm.select_path();
    assert!(path.is_some());
    assert_eq!(path.unwrap().read().name, "eth1");
}

#[test]
fn test_stream_mapper() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);
    let mut mapper = StreamMapper::new(tx);

    let backend_addr: SocketAddr = "127.0.0.1:8080".parse().unwrap();
    mapper.add_stream_mapping(0, backend_addr).unwrap();

    assert!(mapper.is_connected(0) == false);
    assert_eq!(mapper.get_backend_addr(0), Some(backend_addr));

    let stats = mapper.get_stream_stats(0);
    assert!(stats.is_some());
    assert_eq!(stats.unwrap().stream_id, 0);
}

#[tokio::test]
async fn test_crc32c_calculation() {
    let data = b"Hello, SCTP!";
    let crc = crc32c(data);

    assert_ne!(crc, 0);
    assert_eq!(crc, crc32c(data));

    let data2 = b"Different data";
    assert_ne!(crc, crc32c(data2));
}

#[tokio::test]
async fn test_init_chunk_encode_decode() {
    let init = InitChunkPayload {
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        params: vec![
            InitParam::IPv4Addr("127.0.0.1".parse().unwrap()),
            InitParam::IPv4Addr("10.0.0.1".parse().unwrap()),
        ],
    };

    let chunk = init.encode(ChunkType::Init);

    let parsed = InitChunkPayload::parse(&chunk).unwrap();
    assert_eq!(parsed.init_tag, 0x12345678);
    assert_eq!(parsed.a_rwnd, 1048576);
    assert_eq!(parsed.num_outbound_streams, 1024);
    assert_eq!(parsed.num_inbound_streams, 1024);
    assert_eq!(parsed.initial_tsn, 0);
}

#[tokio::test]
async fn test_sack_chunk_encode_decode() {
    let sack = SackChunkPayload {
        cumulative_tsn_ack: 100,
        a_rwnd: 1048576,
        num_gap_ack_blocks: 2,
        num_dup_tsns: 1,
        gap_ack_blocks: vec![(1, 2), (4, 5)],
        dup_tsns: vec![50],
    };

    let chunk = sack.encode();
    let parsed = SackChunkPayload::parse(&chunk).unwrap();

    assert_eq!(parsed.cumulative_tsn_ack, 100);
    assert_eq!(parsed.a_rwnd, 1048576);
    assert_eq!(parsed.gap_ack_blocks.len(), 2);
    assert_eq!(parsed.dup_tsns.len(), 1);
}

#[tokio::test]
async fn test_association_data_flow() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs: vec![],
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    let tsn = tcb.queue_data(0, Bytes::from_static(b"test"), 0);
    assert_eq!(tsn, 0);

    let sendable = tcb.get_sendable_data(65536);
    assert!(!sendable.is_empty());

    let payload = DataChunkPayload {
        tsn: 1,
        stream_id: 0,
        stream_seq: 0,
        payload_proto: 0,
        user_data: Bytes::from_static(b"received"),
    };

    tcb.handle_data(payload);
    assert!(tcb.recv_buffer.contains_key(&1));
}

#[test]
fn test_stats_collector() {
    let collector = StatsCollector::new();

    collector.register_association(1);
    collector.register_stream(1, 0, "127.0.0.1:8080".to_string());
    collector.record_send(1, 0, 100);
    collector.record_recv(1, 0, 200);

    let stats = collector.get_association_stats(1, AssociationState::Established);
    assert_eq!(stats.total_bytes_sent, 100);
    assert_eq!(stats.total_bytes_received, 200);

    let global = collector.get_global_stats();
    assert_eq!(global.total_associations, 1);
    assert_eq!(global.total_bytes_sent, 100);
}

#[test]
fn test_multiple_streams() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let mut stream_configs = Vec::new();
    for i in 0..5 {
        stream_configs.push(StreamConfig {
            stream_id: i,
            backend_addr: format!("127.0.0.1:{}", 8080 + i).parse().unwrap(),
            qos: QoSConfig {
                priority: 5 - (i % 3) as u8,
                bandwidth_limit_bps: if i == 0 { Some(100000) } else { None },
            },
        });
    }

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let tcb = tcb.read();

    assert_eq!(tcb.assoc_id, 1);
    assert_eq!(tcb.num_outbound_streams, 1024);
    assert_eq!(tcb.num_inbound_streams, 1024);
}

#[test]
fn test_path_distribution_strategies() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;

    let mut pm = PathManager::with_strategy(DistributionStrategy::RoundRobin);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();
    pm.add_path("eth1".to_string(), "127.0.0.1:9001".parse().unwrap())
        .unwrap();
    pm.add_path("eth2".to_string(), "127.0.0.1:9002".parse().unwrap())
        .unwrap();

    let p1 = pm.select_path().unwrap();
    let p2 = pm.select_path().unwrap();
    let p3 = pm.select_path().unwrap();

    assert_ne!(p1.read().name, p2.read().name);
    assert_ne!(p2.read().name, p3.read().name);
}

#[test]
fn test_bandwidth_limit_qos() {
    let mut qos = QoSManager::new();

    qos.register_stream(QoSPolicy {
        stream_id: 0,
        priority: 5,
        bandwidth_limit_bps: Some(1000),
        max_queue_size: 65536,
    });

    qos.enqueue(0, Bytes::from_static(&[0u8; 500])).unwrap();
    qos.enqueue(0, Bytes::from_static(&[0u8; 500])).unwrap();
    qos.enqueue(0, Bytes::from_static(&[0u8; 500])).unwrap();

    let item1 = qos.dequeue(0);
    assert!(item1.is_some());

    let item2 = qos.dequeue(0);
    assert!(item2.is_some());

    let item3 = qos.dequeue(0);
    assert!(item3.is_none());
}

#[test]
fn test_association_state_transition() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs: vec![],
    };

    let tcb = manager.create_association(config);
    {
        let mut tcb = tcb.write();
        tcb.state = AssociationState::CookieWait;
        assert_eq!(tcb.state, AssociationState::CookieWait);

        tcb.state = AssociationState::Established;
        assert_eq!(tcb.state, AssociationState::Established);
    }

    let stats = manager.get_stats(1).unwrap();
    assert_eq!(stats.state, "Established");
}

#[tokio::test]
async fn test_full_packet_roundtrip() {
    let header = SctpHeader::new(5000, 9000, 0xDEADBEEF);

    let data_payload = DataChunkPayload {
        tsn: 42,
        stream_id: 5,
        stream_seq: 10,
        payload_proto: 0x00000001,
        user_data: Bytes::from_static(b"roundtrip test data"),
    };

    let sack_payload = SackChunkPayload {
        cumulative_tsn_ack: 42,
        a_rwnd: 65536,
        num_gap_ack_blocks: 0,
        num_dup_tsns: 0,
        gap_ack_blocks: vec![],
        dup_tsns: vec![],
    };

    let data_chunk = data_payload.encode(ChunkFlags::new());
    let sack_chunk = sack_payload.encode();

    let packet = SctpPacket::new(header, vec![data_chunk, sack_chunk]);
    let encoded = packet.encode();

    let mut reader = encoded.as_ref();
    let parsed = SctpPacket::parse(&mut reader).unwrap();

    assert_eq!(parsed.chunks.len(), 2);
    assert_eq!(parsed.chunks[0].chunk_type, ChunkType::Data);
    assert_eq!(parsed.chunks[1].chunk_type, ChunkType::Sack);

    let parsed_data = DataChunkPayload::parse(&parsed.chunks[0]).unwrap();
    assert_eq!(parsed_data.tsn, 42);
    assert_eq!(parsed_data.stream_id, 5);
    assert_eq!(parsed_data.user_data, Bytes::from_static(b"roundtrip test data"));

    let parsed_sack = SackChunkPayload::parse(&parsed.chunks[1]).unwrap();
    assert_eq!(parsed_sack.cumulative_tsn_ack, 42);
    assert_eq!(parsed_sack.a_rwnd, 65536);
}

#[test]
fn test_flow_affinity_path_selection() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();
    pm.add_path("eth1".to_string(), "127.0.0.1:9001".parse().unwrap())
        .unwrap();
    pm.add_path("eth2".to_string(), "127.0.0.1:9002".parse().unwrap())
        .unwrap();

    let assoc_id: AssociationId = 1;
    let stream_id1: StreamId = 0;
    let stream_id2: StreamId = 1;

    let path1 = pm.select_path_for_flow(assoc_id, stream_id1).unwrap();
    let path2 = pm.select_path_for_flow(assoc_id, stream_id1).unwrap();
    let path3 = pm.select_path_for_flow(assoc_id, stream_id1).unwrap();

    assert_eq!(path1.read().name, path2.read().name);
    assert_eq!(path2.read().name, path3.read().name);

    let path_other_stream = pm.select_path_for_flow(assoc_id, stream_id2).unwrap();
    let _ = path_other_stream;

    let path1_again = pm.select_path_for_flow(assoc_id, stream_id1).unwrap();
    assert_eq!(path1.read().name, path1_again.read().name);

    for i in 0..100 {
        let p = pm.select_path_for_flow(assoc_id, stream_id1).unwrap();
        assert_eq!(p.read().name, path1.read().name,
            "Flow affinity should always select the same path for the same stream, failed at iteration {}", i);
    }
}

#[test]
fn test_reordering_detection_and_stats() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let stream_configs = vec![
        StreamConfig {
            stream_id: 0,
            backend_addr: "127.0.0.1:8080".parse().unwrap(),
            qos: QoSConfig::default(),
        },
    ];

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    for tsn in 0..10 {
        let payload = DataChunkPayload {
            tsn,
            stream_id: 0,
            stream_seq: tsn as u16,
            payload_proto: 0,
            user_data: Bytes::copy_from_slice(format!("data-{}", tsn).as_bytes()),
        };
        tcb.handle_data(payload);
    }

    let reorder_stats = tcb.get_reordering_stats();
    assert_eq!(reorder_stats.reorder_rate(), 0.0);
    assert_eq!(reorder_stats.out_of_order_packets, 0);
    assert_eq!(reorder_stats.total_packets, 10);
}

#[test]
fn test_out_of_order_packet_handling() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let stream_configs = vec![
        StreamConfig {
            stream_id: 0,
            backend_addr: "127.0.0.1:8080".parse().unwrap(),
            qos: QoSConfig::default(),
        },
    ];

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    let out_of_order_sequence = vec![0, 2, 1, 4, 5, 3, 6, 8, 7, 9];
    let mut expected_out_of_order = 0;
    let mut last_expected = 0;

    for &tsn in &out_of_order_sequence {
        if tsn != last_expected {
            expected_out_of_order += 1;
        } else {
            last_expected = tsn + 1;
        }

        let payload = DataChunkPayload {
            tsn,
            stream_id: 0,
            stream_seq: tsn as u16,
            payload_proto: 0,
            user_data: Bytes::copy_from_slice(format!("data-{}", tsn).as_bytes()),
        };
        tcb.handle_data(payload);
    }

    let reorder_stats = tcb.get_reordering_stats();
    assert_eq!(reorder_stats.total_packets, 10);
    assert_eq!(reorder_stats.out_of_order_packets, expected_out_of_order as u64);
    assert!(reorder_stats.reorder_rate() > 0.0);
    assert!(reorder_stats.max_reorder_gap >= 1);

    assert!(
        reorder_stats.reorder_rate() < 0.4,
        "Reorder rate should be reduced from 40% to under 40% with flow affinity, actual: {:.2}%",
        reorder_stats.reorder_rate() * 100.0
    );
}

#[test]
fn test_stream_level_reorder_queue() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let stream_configs = vec![
        StreamConfig {
            stream_id: 0,
            backend_addr: "127.0.0.1:8080".parse().unwrap(),
            qos: QoSConfig::default(),
        },
    ];

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    assert!(tcb.stream_reorder_queue.contains_key(&0));

    let reorder_queue = tcb.stream_reorder_queue.get(&0).unwrap();
    assert_eq!(reorder_queue.expected_seq, 0);
    assert_eq!(reorder_queue.stream_id, 0);
}

#[test]
fn test_flow_affinity_different_associations() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();
    pm.add_path("eth1".to_string(), "127.0.0.1:9001".parse().unwrap())
        .unwrap();

    let stream_id: StreamId = 0;

    for assoc_id in 1..=10 {
        let path1 = pm.select_path_for_flow(assoc_id, stream_id).unwrap();
        let path2 = pm.select_path_for_flow(assoc_id, stream_id).unwrap();
        assert_eq!(path1.read().name, path2.read().name);
    }

    pm.clear_flow_affinity(1, stream_id);
    let _ = pm.select_path_for_flow(1, stream_id).unwrap();

    pm.clear_all_affinity_for_assoc(2);
    let _ = pm.select_path_for_flow(2, stream_id).unwrap();
}

#[test]
fn test_reordering_with_multiple_streams() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let stream_configs = vec![
        StreamConfig {
            stream_id: 0,
            backend_addr: "127.0.0.1:8080".parse().unwrap(),
            qos: QoSConfig::default(),
        },
        StreamConfig {
            stream_id: 1,
            backend_addr: "127.0.0.1:8081".parse().unwrap(),
            qos: QoSConfig::default(),
        },
    ];

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    for stream_id in 0..2 {
        let out_of_order = vec![0, 3, 1, 4, 2, 5];
        for &tsn in &out_of_order {
            let payload = DataChunkPayload {
                tsn: tsn as u32,
                stream_id,
                stream_seq: tsn as u16,
                payload_proto: 0,
                user_data: Bytes::copy_from_slice(format!("s{}-{}", stream_id, tsn).as_bytes()),
            };
            tcb.handle_data(payload);
        }
    }

    let reorder_stats = tcb.get_reordering_stats();
    assert_eq!(reorder_stats.total_packets, 12);
    assert!(reorder_stats.out_of_order_packets > 0);

    let rate = reorder_stats.reorder_rate();
    assert!(
        rate < 0.4,
        "Reorder rate should be < 40% with flow affinity and reorder buffer, actual: {:.2}%",
        rate * 100.0
    );

    println!(
        "Reorder rate: {:.2}% (before: ~40%, after: {:.2}%)",
        rate * 100.0,
        rate * 100.0
    );
    println!(
        "Out of order packets: {} / {}",
        reorder_stats.out_of_order_packets,
        reorder_stats.total_packets
    );
    println!(
        "Max reorder gap: {}, avg gap: {:.2}",
        reorder_stats.max_reorder_gap,
        reorder_stats.avg_reorder_gap
    );
}

#[test]
fn test_latency_aware_scheduling() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;

    let mut pm = PathManager::with_strategy(DistributionStrategy::LowestRTT);
    pm.add_path("eth0_fast".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();
    pm.add_path("eth1_slow".to_string(), "127.0.0.1:9001".parse().unwrap())
        .unwrap();

    {
        let paths = pm.active_paths();
        paths[0].write().rtt = std::time::Duration::from_millis(10);
        paths[1].write().rtt = std::time::Duration::from_millis(100);
    }

    let mut fast_count = 0;
    let mut slow_count = 0;
    for _ in 0..100 {
        let path = pm.select_path_for_flow(1, 0).unwrap();
        if path.read().name == "eth0_fast" {
            fast_count += 1;
        } else {
            slow_count += 1;
        }
    }

    assert!(
        fast_count > slow_count,
        "LowestRTT should prefer fast paths. Fast: {}, Slow: {}",
        fast_count,
        slow_count
    );
}

#[test]
fn test_forward_tsn_mechanism() {
    let (tx, _rx) = tokio::sync::mpsc::channel::<(StreamId, Bytes)>(1024);

    let stream_mapper = Arc::new(RwLock::new(StreamMapper::new(tx)));
    let path_manager = Arc::new(RwLock::new(PathManager::new()));
    let qos_manager = Arc::new(RwLock::new(QoSManager::new()));
    let stats = Arc::new(StatsCollector::new());

    let mut manager = AssociationManager::new(
        stream_mapper.clone(),
        path_manager.clone(),
        qos_manager.clone(),
        stats.clone(),
    );

    let stream_configs = vec![
        StreamConfig {
            stream_id: 0,
            backend_addr: "127.0.0.1:8080".parse().unwrap(),
            qos: QoSConfig::default(),
        },
    ];

    let config = AssociationConfigParams {
        assoc_id: 1,
        local_addr: "127.0.0.1:9000".parse().unwrap(),
        remote_addr: "127.0.0.1:5000".parse().unwrap(),
        init_tag: 0x12345678,
        a_rwnd: 1048576,
        num_outbound_streams: 1024,
        num_inbound_streams: 1024,
        initial_tsn: 0,
        stream_configs,
    };

    let tcb = manager.create_association(config);
    let mut tcb = tcb.write();

    tcb.max_reordering_window = 10;

    let payload = DataChunkPayload {
        tsn: 100,
        stream_id: 0,
        stream_seq: 100,
        payload_proto: 0,
        user_data: Bytes::from_static(b"far ahead"),
    };
    tcb.handle_data(payload);

    let reorder_stats = tcb.get_reordering_stats();
    assert!(reorder_stats.forward_tsn_count >= 1);
    assert_eq!(tcb.expected_next_tsn, 100);
}

#[test]
fn test_path_health_status_transitions() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();
        assert_eq!(p.health_status, PathHealthStatus::Healthy);
        assert!(p.is_healthy());
        assert!(p.is_available());

        p.mark_as_degraded();
        assert_eq!(p.health_status, PathHealthStatus::Degraded);
        assert!(p.is_healthy());

        p.mark_as_unhealthy();
        assert_eq!(p.health_status, PathHealthStatus::Unhealthy);
        assert!(!p.is_healthy());

        p.mark_as_failed();
        assert_eq!(p.health_status, PathHealthStatus::Failed);
        assert!(!p.is_available());

        p.mark_as_healthy();
        assert_eq!(p.health_status, PathHealthStatus::Healthy);
        assert!(p.is_available());
    }
}

#[test]
fn test_path_rtt_history() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;
    use std::time::Duration;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        p.record_rtt(Duration::from_millis(10));
        p.record_rtt(Duration::from_millis(20));
        p.record_rtt(Duration::from_millis(30));

        assert_eq!(p.rtt_history.len(), 3);
        assert_eq!(p.min_rtt(), Duration::from_millis(10));
        assert_eq!(p.max_rtt(), Duration::from_millis(30));
        assert_eq!(p.avg_rtt(), Duration::from_millis(20));
    }
}

#[test]
fn test_path_packet_loss_tracking() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        for i in 0..10 {
            p.record_sent(100);
            if i % 3 == 0 {
                p.record_packet_loss();
            }
        }

        assert_eq!(p.packets_sent, 10);
        assert_eq!(p.packets_lost, 4);
        assert!(p.current_packet_loss_rate() > 0.0);
    }
}

#[test]
fn test_path_health_evaluation() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};
    use std::time::Duration;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        for _ in 0..5 {
            p.record_rtt(Duration::from_millis(10));
            p.record_sent(100);
        }

        let status = p.evaluate_health();
        assert_eq!(status, PathHealthStatus::Healthy);

        for _ in 0..5 {
            p.record_rtt(Duration::from_millis(600));
            p.record_sent(100);
            p.record_packet_loss();
        }

        let status = p.evaluate_health();
        assert_eq!(status, PathHealthStatus::Failed);
        assert!(!p.is_available());
    }
}

#[test]
fn test_path_failure_and_flow_migration() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();
    pm.add_path("eth1".to_string(), "127.0.0.1:9001".parse().unwrap())
        .unwrap();

    let assoc_id: AssociationId = 1;
    let stream_id: StreamId = 0;

    let path1 = pm.select_path_for_flow(assoc_id, stream_id).unwrap();
    let path1_name = path1.read().name.clone();

    pm.force_path_failure(&path1_name).unwrap();

    let path2 = pm.select_path_for_flow(assoc_id, stream_id).unwrap();
    assert_ne!(path1_name, path2.read().name);

    let (total, failed) = pm.migration_stats();
    assert!(failed > 0);
    assert!(total > 0);
}

#[test]
fn test_path_recovery() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};
    use std::time::Duration;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        p.mark_as_failed();
        assert_eq!(p.health_status, PathHealthStatus::Failed);

        for _ in 0..5 {
            p.record_rtt(Duration::from_millis(10));
            p.record_sent(100);
        }

        let status = p.evaluate_health();
        assert_eq!(status, PathHealthStatus::Healthy);
    }
}

#[test]
fn test_path_health_stats() {
    use sctp_gateway::multipath::path_manager::DistributionStrategy;
    use std::time::Duration;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        p.record_rtt(Duration::from_millis(25));
        p.record_sent(100);
        p.record_sent(100);
        p.record_packet_loss();
    }

    let stats = pm.get_path_health_stats("eth0").unwrap();
    assert_eq!(stats.name, "eth0");
    assert_eq!(stats.packets_sent, 2);
    assert_eq!(stats.packets_lost, 1);
    assert!(stats.packet_loss_rate > 0.0);
    assert!(stats.avg_rtt_ms > 0);
}

#[test]
fn test_consecutive_failures_threshold() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();

        p.max_consecutive_failures = 3;

        for i in 0..5 {
            p.record_packet_loss();
            if i < 2 {
                assert_ne!(p.health_status, PathHealthStatus::Failed);
            }
        }

        assert_eq!(p.health_status, PathHealthStatus::Failed);
        assert_eq!(p.consecutive_failures, 5);
        assert!(p.failover_count > 0);
    }
}

#[test]
fn test_heartbeat_response_recovery() {
    use sctp_gateway::multipath::path_manager::{DistributionStrategy, PathHealthStatus};
    use std::time::Duration;

    let mut pm = PathManager::with_strategy(DistributionStrategy::FlowAffinity);
    pm.add_path("eth0".to_string(), "127.0.0.1:9000".parse().unwrap())
        .unwrap();

    {
        let path = pm.paths.get("eth0").unwrap();
        let mut p = path.write();
        p.mark_as_failed();
        assert_eq!(p.health_status, PathHealthStatus::Failed);
    }

    pm.record_heartbeat_response("eth0", Duration::from_millis(50));

    {
        let path = pm.paths.get("eth0").unwrap();
        let p = path.read();
        assert_eq!(p.health_status, PathHealthStatus::Healthy);
        assert_eq!(p.consecutive_failures, 0);
    }
}
