import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../models/beacon_config.dart';
import '../services/beacon_config_storage.dart';
import '../services/grpc_client.dart';

class MapCalibrationPage extends StatefulWidget {
  final List<BeaconConfig> initialConfigs;

  const MapCalibrationPage({
    super.key,
    required this.initialConfigs,
  });

  @override
  State<MapCalibrationPage> createState() => _MapCalibrationPageState();
}

class _MapCalibrationPageState extends State<MapCalibrationPage> {
  late List<BeaconConfig> _configs;
  int? _draggingIndex;
  Offset _dragOffset = Offset.zero;
  bool _isSyncing = false;
  bool _hasChanges = false;

  late BeaconConfigStorage _storage;
  GrpcClient? _grpcClient;
  final TextEditingController _hostController = TextEditingController();
  final TextEditingController _portController = TextEditingController();
  final TextEditingController _deviceIdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _configs = List.from(widget.initialConfigs);
    _initStorage();
  }

  @override
  void dispose() {
    _hostController.dispose();
    _portController.dispose();
    _deviceIdController.dispose();
    _grpcClient?.disconnect();
    super.dispose();
  }

  Future<void> _initStorage() async {
    _storage = await BeaconConfigStorage.getInstance();
    _hostController.text = _storage.getServerHost();
    _portController.text = _storage.getServerPort().toString();
    _deviceIdController.text = _storage.getDeviceId();

    if (_deviceIdController.text.isEmpty) {
      _deviceIdController.text = _generateDeviceId();
      await _storage.setDeviceId(_deviceIdController.text);
    }
  }

  String _generateDeviceId() {
    final random = math.Random.secure();
    return List.generate(16, (index) {
      final codeUnit = random.nextInt(26) + 97;
      return String.fromCharCode(codeUnit);
    }).join();
  }

  void _onPanStart(DragStartDetails details, int index, Size size) {
    setState(() {
      _draggingIndex = index;
    });
  }

  void _onPanUpdate(DragUpdateDetails details, int index, Size size) {
    if (_draggingIndex != index) return;

    const scale = 80.0;
    const padding = 40.0;
    final offsetX = size.width / 2;
    final offsetY = size.height / 2;

    final dx = details.delta.dx;
    final dy = details.delta.dy;

    setState(() {
      final config = _configs[index];
      var newX = config.x + dx / scale;
      var newY = config.y - dy / scale;

      final minX = -(size.width - padding * 2) / (2 * scale);
      final maxX = (size.width - padding * 2) / (2 * scale);
      final minY = -(size.height - padding * 2) / (2 * scale);
      final maxY = (size.height - padding * 2) / (2 * scale);

      newX = newX.clamp(minX, maxX);
      newY = newY.clamp(minY, maxY);

      _configs[index] = config.copyWith(
        x: double.parse(newX.toStringAsFixed(2)),
        y: double.parse(newY.toStringAsFixed(2)),
        updatedAt: DateTime.now(),
      );
      _hasChanges = true;
    });
  }

  void _onPanEnd(DragEndDetails details) {
    setState(() {
      _draggingIndex = null;
    });
  }

  Future<void> _saveToLocal() async {
    try {
      await _storage.saveConfigs(_configs);
      _hasChanges = false;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('已保存到本地')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('保存失败: $e')),
        );
      }
    }
  }

  Future<void> _uploadToServer() async {
    setState(() {
      _isSyncing = true;
    });

    try {
      _grpcClient ??= GrpcClient(
        host: _hostController.text,
        port: int.parse(_portController.text),
      );

      if (!_grpcClient!.isConnected) {
        await _grpcClient!.connect();
      }

      final deviceId = _deviceIdController.text;
      final localVersion = _storage.getVersion();

      final updatedConfigs = await _grpcClient!.syncBeaconConfigs(
        deviceId,
        _configs,
        localVersion,
      );

      for (var config in updatedConfigs) {
        final index = _configs.indexWhere((c) => c.identifier == config.identifier);
        if (index >= 0) {
          _configs[index] = config;
        } else {
          _configs.add(config);
        }
      }

      await _storage.saveConfigs(_configs);
      _hasChanges = false;

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('同步成功')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('同步失败: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncing = false;
        });
      }
    }
  }

  Future<void> _fetchFromServer() async {
    setState(() {
      _isSyncing = true;
    });

    try {
      _grpcClient ??= GrpcClient(
        host: _hostController.text,
        port: int.parse(_portController.text),
      );

      if (!_grpcClient!.isConnected) {
        await _grpcClient!.connect();
      }

      final deviceId = _deviceIdController.text;
      final configs = await _grpcClient!.getBeaconConfigs(deviceId);

      if (configs.isNotEmpty) {
        setState(() {
          _configs = configs;
          _hasChanges = true;
        });
        await _storage.saveConfigs(configs);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已获取 ${configs.length} 个配置')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('获取失败: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncing = false;
        });
      }
    }
  }

  void _resetConfig(int index) {
    setState(() {
      _configs[index] = widget.initialConfigs[index];
      _hasChanges = true;
    });
  }

  void _showConfigDialog(int index) {
    final config = _configs[index];
    final xController = TextEditingController(text: config.x.toString());
    final yController = TextEditingController(text: config.y.toString());
    final descController = TextEditingController(text: config.description ?? '');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('信标 ${config.identifier} 设置'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: xController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'X 坐标',
                prefixIcon: Icon(Icons.location_on),
              ),
            ),
            TextField(
              controller: yController,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Y 坐标',
                prefixIcon: Icon(Icons.location_on),
              ),
            ),
            TextField(
              controller: descController,
              decoration: const InputDecoration(
                labelText: '描述',
                prefixIcon: Icon(Icons.description),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              setState(() {
                _configs[index] = config.copyWith(
                  x: double.tryParse(xController.text) ?? config.x,
                  y: double.tryParse(yController.text) ?? config.y,
                  description: descController.text,
                  updatedAt: DateTime.now(),
                );
                _hasChanges = true;
              });
              Navigator.pop(context);
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }

  void _showServerSettings() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('服务器设置'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _hostController,
              decoration: const InputDecoration(
                labelText: '服务器地址',
                prefixIcon: Icon(Icons.cloud),
              ),
            ),
            TextField(
              controller: _portController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '端口',
                prefixIcon: Icon(Icons.settings_ethernet),
              ),
            ),
            TextField(
              controller: _deviceIdController,
              decoration: const InputDecoration(
                labelText: '设备 ID',
                prefixIcon: Icon(Icons.devices),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () async {
              await _storage.setServerHost(_hostController.text);
              await _storage
                  .setServerPort(int.tryParse(_portController.text) ?? 50051);
              await _storage.setDeviceId(_deviceIdController.text);
              _grpcClient?.disconnect();
              _grpcClient = null;
              if (mounted) {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('设置已保存')),
                );
              }
            },
            child: const Text('保存'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('地图校准'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: _showServerSettings,
            tooltip: '服务器设置',
          ),
          IconButton(
            icon: const Icon(Icons.cloud_download),
            onPressed: _isSyncing ? null : _fetchFromServer,
            tooltip: '从服务器获取',
          ),
          IconButton(
            icon: const Icon(Icons.cloud_upload),
            onPressed: _isSyncing ? null : _uploadToServer,
            tooltip: '上传到服务器',
          ),
          IconButton(
            icon: const Icon(Icons.save),
            onPressed: _saveToLocal,
            tooltip: '保存到本地',
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            color: Theme.of(context).colorScheme.primaryContainer,
            child: Row(
              children: [
                const Icon(Icons.info_outline, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _hasChanges
                        ? '有未保存的更改'
                        : '拖动蓝色圆点调整信标位置',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimaryContainer,
                      fontSize: 12,
                    ),
                  ),
                ),
                if (_isSyncing)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final size = Size(constraints.maxWidth, constraints.maxHeight);
                return GestureDetector(
                  child: CustomPaint(
                    painter: CalibrationMapPainter(
                      configs: _configs,
                      draggingIndex: _draggingIndex,
                    ),
                    size: size,
                    child: Stack(
                      children: List.generate(_configs.length, (index) {
                        final config = _configs[index];
                        const scale = 80.0;
                        final offsetX = size.width / 2;
                        final offsetY = size.height / 2;
                        final screenX = offsetX + config.x * scale;
                        final screenY = offsetY - config.y * scale;

                        return Positioned(
                          left: screenX - 24,
                          top: screenY - 24,
                          child: GestureDetector(
                            onPanStart: (details) =>
                                _onPanStart(details, index, size),
                            onPanUpdate: (details) =>
                                _onPanUpdate(details, index, size),
                            onPanEnd: _onPanEnd,
                            onLongPress: () => _showConfigDialog(index),
                            child: DraggableBeaconMarker(
                              config: config,
                              isDragging: _draggingIndex == index,
                              onReset: () => _resetConfig(index),
                              onEdit: () => _showConfigDialog(index),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                );
              },
            ),
          ),
          Container(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                const Text(
                  '信标列表',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 120,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    itemCount: _configs.length,
                    itemBuilder: (context, index) {
                      final config = _configs[index];
                      return Container(
                        width: 140,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        child: Card(
                          child: InkWell(
                            onTap: () => _showConfigDialog(index),
                            child: Padding(
                              padding: const EdgeInsets.all(8.0),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '信标 ${config.identifier}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'X: ${config.x.toStringAsFixed(2)}',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                  Text(
                                    'Y: ${config.y.toStringAsFixed(2)}',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                  if (config.updatedAt != null)
                                    Text(
                                      '更新: ${_formatTime(config.updatedAt!)}',
                                      style: const TextStyle(
                                        fontSize: 10,
                                        color: Colors.grey,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: BottomAppBar(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            TextButton.icon(
              onPressed: _isSyncing ? null : _fetchFromServer,
              icon: const Icon(Icons.cloud_download),
              label: const Text('获取配置'),
            ),
            TextButton.icon(
              onPressed: _isSyncing ? null : _uploadToServer,
              icon: const Icon(Icons.cloud_upload),
              label: const Text('同步配置'),
            ),
            TextButton.icon(
              onPressed: () => Navigator.pop(context, _hasChanges ? _configs : null),
              icon: const Icon(Icons.check),
              label: const Text('完成'),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime time) {
    return '${time.month}/${time.day} ${time.hour}:${time.minute.toString().padLeft(2, '0')}';
  }
}

class CalibrationMapPainter extends CustomPainter {
  final List<BeaconConfig> configs;
  final int? draggingIndex;

  CalibrationMapPainter({
    required this.configs,
    this.draggingIndex,
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

    final textPainter = TextPainter(
      text: TextSpan(
        text: '0,0',
        style: TextStyle(color: Colors.grey[500], fontSize: 10),
      ),
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();
    textPainter.paint(canvas, Offset(offsetX + 4, offsetY + 4));
  }

  @override
  bool shouldRepaint(covariant CalibrationMapPainter oldDelegate) {
    return oldDelegate.configs.length != configs.length ||
        oldDelegate.draggingIndex != draggingIndex;
  }
}

class DraggableBeaconMarker extends StatefulWidget {
  final BeaconConfig config;
  final bool isDragging;
  final VoidCallback onReset;
  final VoidCallback onEdit;

  const DraggableBeaconMarker({
    super.key,
    required this.config,
    required this.isDragging,
    required this.onReset,
    required this.onEdit,
  });

  @override
  State<DraggableBeaconMarker> createState() => _DraggableBeaconMarkerState();
}

class _DraggableBeaconMarkerState extends State<DraggableBeaconMarker> {
  bool _showMenu = false;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 48,
      height: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (widget.isDragging)
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.3),
                shape: BoxShape.circle,
              ),
            ),
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: widget.isDragging ? Colors.blue[700] : Colors.blue,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: widget.isDragging ? 8 : 4,
                  offset: Offset(0, widget.isDragging ? 4 : 2),
                ),
              ],
            ),
            child: Center(
              child: Text(
                widget.config.identifier,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          if (_showMenu)
            Positioned(
              top: -40,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.2),
                      blurRadius: 8,
                    ),
                  ],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit, size: 18),
                      onPressed: () {
                        setState(() => _showMenu = false);
                        widget.onEdit();
                      },
                      tooltip: '编辑',
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, size: 18),
                      onPressed: () {
                        setState(() => _showMenu = false);
                        widget.onReset();
                      },
                      tooltip: '重置',
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
