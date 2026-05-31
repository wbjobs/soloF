import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/ibeacon.dart';
import '../models/position.dart';
import '../models/beacon_config.dart';
import '../services/ble_scanner_service.dart';
import '../services/weighted_centroid.dart';
import '../services/beacon_config_storage.dart';
import '../config/beacon_configs.dart';
import 'map_calibration_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage>
    with WidgetsBindingObserver {
  final BleScannerService _bleScanner = BleScannerService();
  late WeightedCentroidLocalization _localization;
  late BeaconConfigStorage _storage;

  final Map<String, IBeacon> _detectedBeacons = {};
  Position? _currentPosition;
  bool _isScanning = false;
  bool _isBluetoothOn = true;
  bool _isLoadingConfigs = true;
  StreamSubscription<IBeacon>? _beaconSubscription;
  StreamSubscription<BleScannerStatus>? _statusSubscription;

  List<BeaconConfig> _beaconConfigs = defaultBeacons;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _localization = WeightedCentroidLocalization(knownBeacons: _beaconConfigs);
    _initStatusListener();
    _checkInitialState();
    _loadStoredConfigs();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _beaconSubscription?.cancel();
    _statusSubscription?.cancel();
    _bleScanner.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (Platform.isAndroid) {
      if (state == AppLifecycleState.resumed && _isScanning) {
        _restartScanIfNeeded();
      }
    }
  }

  void _initStatusListener() {
    _statusSubscription = _bleScanner.statusStream.listen((status) {
      switch (status.type) {
        case BleStatusType.scanning:
          if (mounted) {
            setState(() {
              _isScanning = status.data as bool;
            });
          }
          break;
        case BleStatusType.adapterState:
          final state = status.data as BluetoothAdapterState;
          if (mounted) {
            setState(() {
              _isBluetoothOn = state == BluetoothAdapterState.on;
            });
          }
          if (state == BluetoothAdapterState.off && _isScanning) {
            _stopScan();
            _showSnackBar('蓝牙已关闭，扫描已停止');
          }
          break;
        case BleStatusType.error:
          _showSnackBar('错误: ${status.data}');
          break;
      }
    });
  }

  Future<void> _checkInitialState() async {
    _isBluetoothOn = await _bleScanner.checkBluetoothEnabled();
    if (mounted) setState(() {});
  }

  Future<void> _loadStoredConfigs() async {
    _storage = await BeaconConfigStorage.getInstance();
    final storedConfigs = await _storage.getConfigs();
    if (storedConfigs.isNotEmpty && mounted) {
      setState(() {
        _beaconConfigs = storedConfigs;
        _localization = WeightedCentroidLocalization(knownBeacons: _beaconConfigs);
        _isLoadingConfigs = false;
      });
    } else if (mounted) {
      setState(() {
        _isLoadingConfigs = false;
      });
    }
  }

  Future<void> _navigateToCalibration() async {
    final result = await Navigator.push<List<BeaconConfig>>(
      context,
      MaterialPageRoute(
        builder: (context) => MapCalibrationPage(initialConfigs: _beaconConfigs),
      ),
    );

    if (result != null && result.isNotEmpty && mounted) {
      setState(() {
        _beaconConfigs = result;
        _localization = WeightedCentroidLocalization(knownBeacons: _beaconConfigs);
        _updatePosition();
      });
    }
  }

  Future<void> _restartScanIfNeeded() async {
    try {
      await _bleScanner.stopScan();
      await Future.delayed(const Duration(milliseconds: 500));
      await _bleScanner.startScan();
    } catch (e) {
      // Ignore restart errors
    }
  }

  Future<void> _toggleScan() async {
    if (_isScanning) {
      await _stopScan();
    } else {
      await _startScanWithPermissionCheck();
    }
  }

  Future<void> _startScanWithPermissionCheck() async {
    try {
      final permissionResult = await _bleScanner.checkPermissions();

      if (permissionResult == BlePermissionResult.permanentlyDenied) {
        _showPermissionDialog(
          title: '权限被拒绝',
          content: '蓝牙权限被永久拒绝，请在系统设置中开启蓝牙权限后继续使用。',
          showSettingsButton: true,
        );
        return;
      }

      if (permissionResult != BlePermissionResult.granted) {
        final requestResult = await _bleScanner.requestPermissions();
        if (requestResult != BlePermissionResult.granted) {
          _showSnackBar('需要蓝牙权限才能扫描信标');
          return;
        }
      }

      if (!await _bleScanner.checkBluetoothEnabled()) {
        _showSnackBar('请先开启蓝牙');
        return;
      }

      await _startScan();
    } on BlePermissionException catch (e) {
      _showSnackBar(e.message);
    } catch (e) {
      if (mounted) {
        _showSnackBar('无法开始扫描: $e');
      }
    }
  }

  Future<void> _startScan() async {
    try {
      _detectedBeacons.clear();
      _currentPosition = null;
      if (mounted) setState(() {});

      _beaconSubscription?.cancel();
      _beaconSubscription = _bleScanner.beaconStream.listen(
        (ibeacon) {
          if (mounted) {
            setState(() {
              _detectedBeacons[ibeacon.uuid] = ibeacon;
              _updatePosition();
            });
          }
        },
        onError: (e) {
          if (mounted) {
            _showSnackBar('扫描错误: $e');
          }
        },
      );

      await _bleScanner.startScan();
    } on BleScannerException catch (e) {
      _showSnackBar(e.message);
    } on BlePermissionException catch (e) {
      _showSnackBar(e.message);
    } catch (e) {
      if (mounted) {
        _showSnackBar('扫描失败: $e');
      }
    }
  }

  Future<void> _stopScan() async {
    try {
      await _beaconSubscription?.cancel();
      _beaconSubscription = null;
      await _bleScanner.stopScan();
      if (mounted) {
        setState(() {
          _isScanning = false;
        });
      }
    } catch (e) {
      if (mounted) {
        _showSnackBar('停止扫描失败: $e');
      }
    }
  }

  void _updatePosition() {
    final beacons = _detectedBeacons.values.toList();
    if (beacons.length >= 3) {
      final position = _localization.calculatePosition(beacons);
      if (position.accuracy >= 0 && mounted) {
        setState(() {
          _currentPosition = position;
        });
      }
    }
  }

  void _showSnackBar(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 3),
        action: SnackBarAction(
          label: '知道了',
          onPressed: () {},
        ),
      ),
    );
  }

  void _showPermissionDialog({
    required String title,
    required String content,
    bool showSettingsButton = false,
  }) {
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          if (showSettingsButton)
            TextButton(
              onPressed: () {
                openAppSettings();
                Navigator.pop(context);
              },
              child: const Text('打开设置'),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('BLE 室内定位'),
        centerTitle: true,
        actions: [
          if (_isLoadingConfigs)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.map),
            onPressed: _isLoadingConfigs ? null : _navigateToCalibration,
            tooltip: '地图校准',
          ),
          IconButton(
            icon: Icon(
              _isBluetoothOn ? Icons.bluetooth : Icons.bluetooth_disabled,
              color: _isBluetoothOn ? Colors.blue : Colors.grey,
            ),
            onPressed: _showBluetoothStatus,
          ),
        ],
      ),
      body: Column(
        children: [
          if (!_isBluetoothOn)
            Container(
              color: Colors.orange[100],
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  const Icon(Icons.warning, color: Colors.orange),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text('蓝牙未开启，请先开启蓝牙'),
                  ),
                ],
              ),
            ),
          Expanded(
            flex: 3,
            child: _buildPositionMap(),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            child: _buildCurrentPosition(),
          ),
          const Divider(height: 1),
          Expanded(
            flex: 2,
            child: _buildBeaconList(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _isBluetoothOn ? _toggleScan : null,
        icon: Icon(_isScanning ? Icons.stop : Icons.bluetooth_searching),
        label: Text(_isScanning ? '停止扫描' : '开始扫描'),
        backgroundColor: _isScanning
            ? Colors.red
            : (_isBluetoothOn ? Colors.blue : Colors.grey),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
    );
  }

  void _showBluetoothStatus() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('蓝牙状态'),
        content: Text(_isBluetoothOn ? '蓝牙已开启' : '蓝牙已关闭'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('确定'),
          ),
        ],
      ),
    );
  }

  Widget _buildPositionMap() {
    return Container(
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey),
        borderRadius: BorderRadius.circular(12),
        color: Colors.grey[50],
      ),
      child: CustomPaint(
        painter: PositionMapPainter(
          beacons: _beaconConfigs,
          detectedBeacons: _detectedBeacons.values.toList(),
          currentPosition: _currentPosition,
        ),
        size: Size.infinite,
      ),
    );
  }

  Widget _buildCurrentPosition() {
    return Column(
      children: [
        const Text(
          '当前位置估算',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 8),
        if (_currentPosition != null && _currentPosition!.accuracy >= 0)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              Column(
                children: [
                  const Text('X 坐标', style: TextStyle(color: Colors.grey)),
                  Text(
                    '${_currentPosition!.x.toStringAsFixed(2)} m',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Column(
                children: [
                  const Text('Y 坐标', style: TextStyle(color: Colors.grey)),
                  Text(
                    '${_currentPosition!.y.toStringAsFixed(2)} m',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              Column(
                children: [
                  const Text('精度', style: TextStyle(color: Colors.grey)),
                  Text(
                    '${_currentPosition!.accuracy.toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ],
          )
        else
          Text(
            _detectedBeacons.length < 3
                ? '需要至少 3 个信标才能计算位置 (当前: ${_detectedBeacons.length})'
                : '位置计算中...',
            style: const TextStyle(color: Colors.grey),
          ),
      ],
    );
  }

  Widget _buildBeaconList() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(8.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                '检测到的信标 (${_detectedBeacons.length})',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (_isScanning)
                const Padding(
                  padding: EdgeInsets.only(left: 8),
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: _detectedBeacons.isEmpty
              ? Center(
                  child: Text(
                    _isScanning
                        ? '正在扫描信标...'
                        : '暂无信标数据，请点击开始扫描',
                  ),
                )
              : ListView.builder(
                  itemCount: _detectedBeacons.length,
                  itemBuilder: (context, index) {
                    final beacon = _detectedBeacons.values.toList()[index];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: _getRssiColor(beacon.rssi),
                        child: Text(
                          '${beacon.rssi}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      title: Text(
                        'Major: ${beacon.major}, Minor: ${beacon.minor}',
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                      subtitle: Text(
                        'UUID: ${beacon.uuid.substring(0, 8)}...\n'
                        '距离: ${beacon.distance.toStringAsFixed(2)}m, Tx: ${beacon.txPower}dBm',
                      ),
                      isThreeLine: true,
                      trailing: Icon(
                        Icons.circle,
                        color: _getRssiColor(beacon.rssi),
                        size: 12,
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Color _getRssiColor(int rssi) {
    if (rssi > -50) return Colors.green;
    if (rssi > -70) return Colors.orange;
    return Colors.red;
  }
}

class PositionMapPainter extends CustomPainter {
  final List<BeaconConfig> beacons;
  final List<IBeacon> detectedBeacons;
  final Position? currentPosition;

  PositionMapPainter({
    required this.beacons,
    required this.detectedBeacons,
    this.currentPosition,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    const padding = 40.0;

    const scale = 80.0;

    final offsetX = size.width / 2;
    final offsetY = size.height / 2;

    paint.strokeWidth = 1;
    paint.color = Colors.grey[300]!;
    for (double x = -10; x <= 10; x += 1) {
      final screenX = offsetX + x * scale;
      if (screenX >= padding && screenX <= size.width - padding) {
        canvas.drawLine(
          Offset(screenX, padding),
          Offset(screenX, size.height - padding),
          paint,
        );
      }
    }
    for (double y = -10; y <= 10; y += 1) {
      final screenY = offsetY - y * scale;
      if (screenY >= padding && screenY <= size.height - padding) {
        canvas.drawLine(
          Offset(padding, screenY),
          Offset(size.width - padding, screenY),
          paint,
        );
      }
    }

    paint.strokeWidth = 2;
    paint.color = Colors.grey[400]!;
    canvas.drawLine(
      Offset(padding, offsetY),
      Offset(size.width - padding, offsetY),
      paint,
    );
    canvas.drawLine(
      Offset(offsetX, padding),
      Offset(offsetX, size.height - padding),
      paint,
    );

    for (var i = 0; i < beacons.length; i++) {
      final beacon = beacons[i];
      final screenX = offsetX + beacon.x * scale;
      final screenY = offsetY - beacon.y * scale;

      paint.color = Colors.blue;
      paint.style = PaintingStyle.fill;
      canvas.drawCircle(
        Offset(screenX, screenY),
        16,
        paint,
      );

      final textPainter = TextPainter(
        text: TextSpan(
          text: 'B${i + 1}',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      textPainter.layout();
      textPainter.paint(
        canvas,
        Offset(screenX - textPainter.width / 2, screenY - textPainter.height / 2),
      );

      final labelPainter = TextPainter(
        text: TextSpan(
          text: '(${beacon.x.toStringAsFixed(1)}, ${beacon.y.toStringAsFixed(1)})',
          style: TextStyle(
            color: Colors.grey[600],
            fontSize: 10,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      labelPainter.layout();
      labelPainter.paint(
        canvas,
        Offset(screenX - labelPainter.width / 2, screenY + 20),
      );
    }

    for (var detected in detectedBeacons) {
      for (var i = 0; i < beacons.length; i++) {
        final beacon = beacons[i];
        if (detected.uuid.toLowerCase().contains(beacon.identifier.toLowerCase()) ||
            detected.minor.toString() == beacon.identifier ||
            detected.major.toString() == beacon.identifier) {
          final screenX = offsetX + beacon.x * scale;
          final screenY = offsetY - beacon.y * scale;
          final radius = detected.distance * scale;

          paint.style = PaintingStyle.stroke;
          paint.strokeWidth = 2;
          paint.color = Colors.blue.withOpacity(0.3);
          canvas.drawCircle(
            Offset(screenX, screenY),
            radius.clamp(10, 200),
            paint,
          );
          break;
        }
      }
    }

    if (currentPosition != null && currentPosition!.accuracy >= 0) {
      final posX = offsetX + currentPosition!.x * scale;
      final posY = offsetY - currentPosition!.y * scale;

      paint.style = PaintingStyle.fill;
      paint.color = Colors.green.withOpacity(0.3);
      canvas.drawCircle(
        Offset(posX, posY),
        30,
        paint,
      );

      paint.color = Colors.green;
      canvas.drawCircle(
        Offset(posX, posY),
        12,
        paint,
      );

      paint.color = Colors.white;
      canvas.drawCircle(
        Offset(posX, posY),
        5,
        paint,
      );

      final posLabel = TextPainter(
        text: TextSpan(
          text: '(${currentPosition!.x.toStringAsFixed(2)}, ${currentPosition!.y.toStringAsFixed(2)})',
          style: const TextStyle(
            color: Colors.green,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      );
      posLabel.layout();
      posLabel.paint(
        canvas,
        Offset(posX - posLabel.width / 2, posY - 30),
      );
    }
  }

  @override
  bool shouldRepaint(covariant PositionMapPainter oldDelegate) {
    return oldDelegate.detectedBeacons.length != detectedBeacons.length ||
        oldDelegate.currentPosition != currentPosition;
  }
}
