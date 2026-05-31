import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/beacon_config.dart';

class BeaconConfigStorage {
  static const String _keyConfigs = 'beacon_configs';
  static const String _keyVersion = 'beacon_configs_version';
  static const String _keyDeviceId = 'device_id';
  static const String _keyServerHost = 'grpc_server_host';
  static const String _keyServerPort = 'grpc_server_port';

  final SharedPreferences _prefs;

  BeaconConfigStorage._(this._prefs);

  static Future<BeaconConfigStorage> getInstance() async {
    final prefs = await SharedPreferences.getInstance();
    return BeaconConfigStorage._(prefs);
  }

  Future<List<BeaconConfig>> getConfigs() async {
    final jsonStr = _prefs.getString(_keyConfigs);
    if (jsonStr == null || jsonStr.isEmpty) {
      return [];
    }

    try {
      final List<dynamic> jsonList = jsonDecode(jsonStr) as List<dynamic>;
      return jsonList
          .map((json) => BeaconConfig.fromJson(json as Map<String, dynamic>))
          .toList();
    } catch (e) {
      return [];
    }
  }

  Future<void> saveConfigs(List<BeaconConfig> configs) async {
    final jsonList = configs.map((config) => config.toJson()).toList();
    final jsonStr = jsonEncode(jsonList);
    await _prefs.setString(_keyConfigs, jsonStr);
    await incrementVersion();
  }

  Future<void> updateConfig(BeaconConfig config) async {
    final configs = await getConfigs();
    final index = configs.indexWhere((c) => c.identifier == config.identifier);
    if (index >= 0) {
      configs[index] = config;
    } else {
      configs.add(config);
    }
    await saveConfigs(configs);
  }

  Future<void> deleteConfig(String identifier) async {
    final configs = await getConfigs();
    configs.removeWhere((c) => c.identifier == identifier);
    await saveConfigs(configs);
  }

  Future<void> clearConfigs() async {
    await _prefs.remove(_keyConfigs);
    await _prefs.remove(_keyVersion);
  }

  int getVersion() {
    return _prefs.getInt(_keyVersion) ?? 0;
  }

  Future<void> setVersion(int version) async {
    await _prefs.setInt(_keyVersion, version);
  }

  Future<void> incrementVersion() async {
    final current = getVersion();
    await setVersion(current + 1);
  }

  String getDeviceId() {
    return _prefs.getString(_keyDeviceId) ?? '';
  }

  Future<void> setDeviceId(String deviceId) async {
    await _prefs.setString(_keyDeviceId, deviceId);
  }

  String getServerHost() {
    return _prefs.getString(_keyServerHost) ?? '127.0.0.1';
  }

  Future<void> setServerHost(String host) async {
    await _prefs.setString(_keyServerHost, host);
  }

  int getServerPort() {
    return _prefs.getInt(_keyServerPort) ?? 50051;
  }

  Future<void> setServerPort(int port) async {
    await _prefs.setInt(_keyServerPort, port);
  }
}
