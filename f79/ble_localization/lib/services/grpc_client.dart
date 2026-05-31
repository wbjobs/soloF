import 'dart:async';
import 'package:grpc/grpc.dart';
import '../models/beacon_config.dart';
import 'beacon_config.pbgrpc.dart';

class GrpcClient {
  static const String defaultHost = '127.0.0.1';
  static const int defaultPort = 50051;

  late BeaconConfigServiceClient _stub;
  ClientChannel? _channel;
  String _host = defaultHost;
  int _port = defaultPort;
  bool _isConnected = false;

  GrpcClient({String? host, int? port}) {
    if (host != null) _host = host;
    if (port != null) _port = port;
  }

  bool get isConnected => _isConnected;
  String get host => _host;
  int get port => _port;

  Future<void> connect() async {
    try {
      _channel = ClientChannel(
        _host,
        port: _port,
        options: const ChannelOptions(
          credentials: ChannelCredentials.insecure(),
          idleTimeout: Duration(minutes: 5),
          connectionTimeout: Duration(seconds: 10),
        ),
      );
      _stub = BeaconConfigServiceClient(_channel!);
      _isConnected = true;
    } catch (e) {
      _isConnected = false;
      rethrow;
    }
  }

  Future<void> disconnect() async {
    await _channel?.terminate();
    _channel = null;
    _isConnected = false;
  }

  Future<List<BeaconConfig>> getBeaconConfigs(String deviceId) async {
    if (!_isConnected) await connect();

    try {
      final request = GetBeaconConfigsRequest()..deviceId = deviceId;
      final response = await _stub.getBeaconConfigs(
        request,
        options: CallOptions(timeout: const Duration(seconds: 10)),
      );

      return response.configs.map((config) {
        return BeaconConfig(
          identifier: config.identifier,
          x: config.x,
          y: config.y,
          description: config.description,
          updatedAt: DateTime.fromMillisecondsSinceEpoch(config.updatedAt.toInt()),
          updatedBy: config.updatedBy,
        );
      }).toList();
    } on GrpcError catch (e) {
      throw GrpcClientException('获取配置失败: ${e.message}');
    } catch (e) {
      throw GrpcClientException('获取配置失败: $e');
    }
  }

  Future<BeaconConfig> updateBeaconConfig(
    String deviceId,
    BeaconConfig config,
  ) async {
    if (!_isConnected) await connect();

    try {
      final beaconConfig = BeaconConfigMessage()
        ..identifier = config.identifier
        ..x = config.x
        ..y = config.y
        ..description = config.description ?? ''
        ..updatedAt = Int64(config.updatedAt?.millisecondsSinceEpoch ??
            DateTime.now().millisecondsSinceEpoch)
        ..updatedBy = config.updatedBy ?? deviceId;

      final request = UpdateBeaconConfigRequest()
        ..deviceId = deviceId
        ..config = beaconConfig;

      final response = await _stub.updateBeaconConfig(
        request,
        options: CallOptions(timeout: const Duration(seconds: 10)),
      );

      if (!response.success) {
        throw GrpcClientException(response.message);
      }

      return BeaconConfig(
        identifier: response.config.identifier,
        x: response.config.x,
        y: response.config.y,
        description: response.config.description,
        updatedAt: DateTime.fromMillisecondsSinceEpoch(
          response.config.updatedAt.toInt(),
        ),
        updatedBy: response.config.updatedBy,
      );
    } on GrpcError catch (e) {
      throw GrpcClientException('更新配置失败: ${e.message}');
    } catch (e) {
      throw GrpcClientException('更新配置失败: $e');
    }
  }

  Future<List<BeaconConfig>> syncBeaconConfigs(
    String deviceId,
    List<BeaconConfig> localConfigs,
    int localVersion,
  ) async {
    if (!_isConnected) await connect();

    try {
      final request = SyncBeaconConfigsRequest()
        ..deviceId = deviceId
        ..configs.addAll(localConfigs.map((config) {
          return BeaconConfigMessage()
            ..identifier = config.identifier
            ..x = config.x
            ..y = config.y
            ..description = config.description ?? ''
            ..updatedAt = Int64(config.updatedAt?.millisecondsSinceEpoch ??
                DateTime.now().millisecondsSinceEpoch)
            ..updatedBy = config.updatedBy ?? deviceId;
        }))
        ..clientVersion = Int64(localVersion);

      final response = await _stub.syncBeaconConfigs(
        request,
        options: CallOptions(timeout: const Duration(seconds: 15)),
      );

      if (!response.success) {
        throw GrpcClientException(response.message);
      }

      return response.updatedConfigs.map((config) {
        return BeaconConfig(
          identifier: config.identifier,
          x: config.x,
          y: config.y,
          description: config.description,
          updatedAt: DateTime.fromMillisecondsSinceEpoch(
            config.updatedAt.toInt(),
          ),
          updatedBy: config.updatedBy,
        );
      }).toList();
    } on GrpcError catch (e) {
      throw GrpcClientException('同步配置失败: ${e.message}');
    } catch (e) {
      throw GrpcClientException('同步配置失败: $e');
    }
  }

  Stream<BeaconConfig> subscribeToUpdates(String deviceId, int lastVersion) {
    if (!_isConnected) {
      throw GrpcClientException('未连接到服务器');
    }

    try {
      final request = SubscribeBeaconConfigUpdatesRequest()
        ..deviceId = deviceId
        ..lastKnownVersion = Int64(lastVersion);

      final responseStream = _stub.subscribeBeaconConfigUpdates(request);

      return responseStream.map((update) {
        return BeaconConfig(
          identifier: update.config.identifier,
          x: update.config.x,
          y: update.config.y,
          description: update.config.description,
          updatedAt: DateTime.fromMillisecondsSinceEpoch(
            update.config.updatedAt.toInt(),
          ),
          updatedBy: update.updatedBy,
        );
      });
    } on GrpcError catch (e) {
      throw GrpcClientException('订阅更新失败: ${e.message}');
    } catch (e) {
      throw GrpcClientException('订阅更新失败: $e');
    }
  }
}

class GrpcClientException implements Exception {
  final String message;
  GrpcClientException(this.message);

  @override
  String toString() => 'GrpcClientException: $message';
}
