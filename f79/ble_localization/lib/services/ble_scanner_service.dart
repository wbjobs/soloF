import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/ibeacon.dart';

class BleScannerService {
  final _beaconController = StreamController<IBeacon>.broadcast();
  final _scanResultsController =
      StreamController<List<ScanResult>>.broadcast();
  final _statusController = StreamController<BleScannerStatus>.broadcast();

  StreamSubscription? _scanSubscription;
  StreamSubscription<BluetoothAdapterState>? _adapterStateSubscription;

  bool _isScanning = false;
  bool _isDisposed = false;

  Stream<IBeacon> get beaconStream => _beaconController.stream;
  Stream<List<ScanResult>> get scanResultsStream =>
      _scanResultsController.stream;
  Stream<BleScannerStatus> get statusStream => _statusController.stream;
  bool get isScanning => _isScanning;

  BleScannerService() {
    _init();
  }

  void _init() {
    _adapterStateSubscription = FlutterBluePlus.adapterState.listen((state) {
      _statusController.add(BleScannerStatus.adapterState(state));
    });
  }

  Future<BlePermissionResult> checkPermissions() async {
    if (kIsWeb) {
      return BlePermissionResult.unknown;
    }

    if (Platform.isAndroid) {
      return await _checkAndroidPermissions();
    } else if (Platform.isIOS) {
      return await _checkIosPermissions();
    } else if (Platform.isWindows) {
      return await _checkWindowsPermissions();
    } else if (Platform.isMacOS) {
      return BlePermissionResult.granted;
    }

    return BlePermissionResult.unknown;
  }

  Future<BlePermissionResult> _checkAndroidPermissions() async {
    final bluetoothStatus = await Permission.bluetoothScan.status;
    final bluetoothConnectStatus = await Permission.bluetoothConnect.status;

    if (bluetoothStatus.isGranted && bluetoothConnectStatus.isGranted) {
      return BlePermissionResult.granted;
    }

    if (bluetoothStatus.isPermanentlyDenied ||
        bluetoothConnectStatus.isPermanentlyDenied) {
      return BlePermissionResult.permanentlyDenied;
    }

    return BlePermissionResult.denied;
  }

  Future<BlePermissionResult> _checkIosPermissions() async {
    final bluetoothStatus = await Permission.bluetooth.status;

    if (bluetoothStatus.isGranted) {
      return BlePermissionResult.granted;
    }
    if (bluetoothStatus.isPermanentlyDenied) {
      return BlePermissionResult.permanentlyDenied;
    }
    return BlePermissionResult.denied;
  }

  Future<BlePermissionResult> _checkWindowsPermissions() async {
    try {
      final isAvailable = await FlutterBluePlus.isAvailable;
      if (isAvailable) {
        return BlePermissionResult.granted;
      }
      return BlePermissionResult.denied;
    } catch (e) {
      return BlePermissionResult.denied;
    }
  }

  Future<BlePermissionResult> requestPermissions() async {
    if (kIsWeb) {
      return BlePermissionResult.unknown;
    }

    if (Platform.isAndroid) {
      return await _requestAndroidPermissions();
    } else if (Platform.isIOS) {
      return await _requestIosPermissions();
    } else if (Platform.isWindows) {
      return await _checkWindowsPermissions();
    }

    return BlePermissionResult.granted;
  }

  Future<BlePermissionResult> _requestAndroidPermissions() async {
    Map<Permission, PermissionStatus> statuses = await [
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.notification,
    ].request();

    final scanGranted = statuses[Permission.bluetoothScan]?.isGranted ?? false;
    final connectGranted =
        statuses[Permission.bluetoothConnect]?.isGranted ?? false;

    if (scanGranted && connectGranted) {
      return BlePermissionResult.granted;
    }

    final scanPermanentlyDenied =
        statuses[Permission.bluetoothScan]?.isPermanentlyDenied ?? false;
    final connectPermanentlyDenied =
        statuses[Permission.bluetoothConnect]?.isPermanentlyDenied ?? false;

    if (scanPermanentlyDenied || connectPermanentlyDenied) {
      return BlePermissionResult.permanentlyDenied;
    }

    return BlePermissionResult.denied;
  }

  Future<BlePermissionResult> _requestIosPermissions() async {
    final status = await Permission.bluetooth.request();
    if (status.isGranted) {
      return BlePermissionResult.granted;
    }
    if (status.isPermanentlyDenied) {
      return BlePermissionResult.permanentlyDenied;
    }
    return BlePermissionResult.denied;
  }

  Future<bool> checkBluetoothEnabled() async {
    try {
      final adapterState = await FlutterBluePlus.adapterState.first;
      return adapterState == BluetoothAdapterState.on;
    } catch (e) {
      return false;
    }
  }

  Future<void> startScan({
    Duration timeout = const Duration(seconds: 30),
    List<Guid> withServices = const [],
    String? macAddress,
  }) async {
    if (_isDisposed) throw BleScannerException('Service is disposed');
    if (_isScanning) return;

    final permissionResult = await checkPermissions();
    if (permissionResult != BlePermissionResult.granted) {
      throw BlePermissionException(permissionResult);
    }

    final isBluetoothOn = await checkBluetoothEnabled();
    if (!isBluetoothOn) {
      throw BleScannerException('Bluetooth is not enabled');
    }

    try {
      if (Platform.isAndroid) {
        await _startAndroidScan(timeout, withServices, macAddress);
      } else {
        await _startGenericScan(timeout, withServices, macAddress);
      }

      _isScanning = true;
      _statusController.add(BleScannerStatus.scanning(true));

      _listenToScanResults();
    } on PlatformException catch (e) {
      _isScanning = false;
      _statusController.add(BleScannerStatus.scanning(false));
      if (Platform.isWindows) {
        throw BleScannerException(
          'Windows BLE 权限不足，请确保已在设置中开启蓝牙权限。错误: ${e.message}',
        );
      }
      rethrow;
    } catch (e) {
      _isScanning = false;
      _statusController.add(BleScannerStatus.scanning(false));
      rethrow;
    }
  }

  Future<void> _startAndroidScan(
    Duration timeout,
    List<Guid> withServices,
    String? macAddress,
  ) async {
    try {
      await FlutterBluePlus.startScan(
        timeout: timeout,
        androidUsesFineLocation: false,
        androidScanMode: AndroidScanMode.lowLatency,
        androidAllowDuplicates: true,
        withServices: withServices,
      );
    } catch (e) {
      await FlutterBluePlus.startScan(
        timeout: timeout,
        androidUsesFineLocation: false,
        androidAllowDuplicates: true,
        withServices: withServices,
      );
    }
  }

  Future<void> _startGenericScan(
    Duration timeout,
    List<Guid> withServices,
    String? macAddress,
  ) async {
    await FlutterBluePlus.startScan(
      timeout: timeout,
      withServices: withServices,
    );
  }

  void _listenToScanResults() {
    _scanSubscription?.cancel();
    _scanSubscription = FlutterBluePlus.scanResults.listen(
      (results) {
        if (_isDisposed) return;
        _scanResultsController.add(results);
        for (var result in results) {
          final ibeacon = _parseIBeacon(result);
          if (ibeacon != null && !_isDisposed) {
            _beaconController.add(ibeacon);
          }
        }
      },
      onError: (e) {
        if (_isDisposed) return;
        _beaconController.addError(e);
        _statusController.add(BleScannerStatus.error(e.toString()));
      },
      onDone: () {
        if (_isDisposed) return;
        _isScanning = false;
        _statusController.add(BleScannerStatus.scanning(false));
      },
    );
  }

  IBeacon? _parseIBeacon(ScanResult result) {
    final manufacturerData = result.advertisementData.manufacturerData;
    if (manufacturerData.isEmpty) return null;

    try {
      final dataEntry = manufacturerData.entries.first;
      final fullData = [
        (dataEntry.key & 0xFF),
        ((dataEntry.key >> 8) & 0xFF),
        ...dataEntry.value,
      ];

      return IBeacon.fromAdvertisementData(
        fullData,
        result.rssi,
        result.device.remoteId.str,
      );
    } catch (e) {
      return null;
    }
  }

  Future<void> stopScan() async {
    try {
      await FlutterBluePlus.stopScan();
    } catch (e) {
      // Ignore stop scan errors
    } finally {
      await _scanSubscription?.cancel();
      _scanSubscription = null;
      _isScanning = false;
      if (!_isDisposed) {
        _statusController.add(BleScannerStatus.scanning(false));
      }
    }
  }

  void dispose() {
    if (_isDisposed) return;
    _isDisposed = true;
    stopScan();
    _adapterStateSubscription?.cancel();
    _beaconController.close();
    _scanResultsController.close();
    _statusController.close();
  }
}

enum BlePermissionResult {
  granted,
  denied,
  permanentlyDenied,
  unknown,
}

class BleScannerStatus {
  final BleStatusType type;
  final dynamic data;

  BleScannerStatus._(this.type, this.data);

  factory BleScannerStatus.scanning(bool isScanning) =>
      BleScannerStatus._(BleStatusType.scanning, isScanning);

  factory BleScannerStatus.adapterState(BluetoothAdapterState state) =>
      BleScannerStatus._(BleStatusType.adapterState, state);

  factory BleScannerStatus.error(String message) =>
      BleScannerStatus._(BleStatusType.error, message);
}

enum BleStatusType {
  scanning,
  adapterState,
  error,
}

class BleScannerException implements Exception {
  final String message;
  BleScannerException(this.message);

  @override
  String toString() => 'BleScannerException: $message';
}

class BlePermissionException implements Exception {
  final BlePermissionResult result;
  BlePermissionException(this.result);

  String get message {
    switch (result) {
      case BlePermissionResult.denied:
        return '蓝牙权限被拒绝，请在应用设置中开启权限';
      case BlePermissionResult.permanentlyDenied:
        return '蓝牙权限被永久拒绝，请在系统设置中开启蓝牙权限';
      case BlePermissionResult.granted:
        return '权限已授予';
      case BlePermissionResult.unknown:
        return '未知权限状态';
    }
  }

  @override
  String toString() => 'BlePermissionException: $message';
}
