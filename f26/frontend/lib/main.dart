import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:image/image.dart' as img;
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:permission_handler/permission_handler.dart';
import 'package:exif/exif.dart';
import 'package:intl/intl.dart';
import 'database_helper.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '植物病害识别',
      theme: ThemeData(primarySwatch: Colors.green),
      home: const HomePage(),
      debugShowCheckedModeBanner: false,
      routes: {
        '/history': (context) => const HistoryPage(),
      },
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  File? _imageFile;
  bool _isLoading = false;
  String? _diseaseName;
  double? _confidence;
  String? _symptom;
  List<String>? _advice;
  CameraController? _cameraController;
  List<CameraDescription>? _cameras;

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    final status = await Permission.camera.request();
    if (status.isGranted) {
      _cameras = await availableCameras();
      if (_cameras != null && _cameras!.isNotEmpty) {
        _cameraController = CameraController(
          _cameras![0],
          ResolutionPreset.medium,
        );
        await _cameraController?.initialize();
        if (mounted) setState(() {});
      }
    }
  }

  Future<int> _getExifOrientation(File imageFile) async {
    try {
      final bytes = await imageFile.readAsBytes();
      final tags = await readExifFromBytes(bytes);
      final orientationTag = tags['Image Orientation'];
      if (orientationTag != null) {
        return orientationTag.values.firstAsInt() ?? 1;
      }
    } catch (e) {
      print('Error reading EXIF: $e');
    }
    return 1;
  }

  img.Image _applyExifOrientation(img.Image image, int orientation) {
    switch (orientation) {
      case 2:
        return img.flipHorizontal(image);
      case 3:
        return img.rotate180(image);
      case 4:
        return img.flipVertical(image);
      case 5:
        return img.flipHorizontal(img.rotate90(image));
      case 6:
        return img.rotate90(image);
      case 7:
        return img.flipHorizontal(img.rotate270(image));
      case 8:
        return img.rotate270(image);
      default:
        return image;
    }
  }

  Future<Uint8List> _compressImage(File imageFile) async {
    final bytes = await imageFile.readAsBytes();
    final image = img.decodeImage(bytes);
    if (image == null) return bytes;
    
    final orientation = await _getExifOrientation(imageFile);
    final orientedImage = _applyExifOrientation(image, orientation);
    
    final resized = img.copyResize(orientedImage, width: 224, height: 224);
    return Uint8List.fromList(img.encodeJpg(resized, quality: 85));
  }

  Future<void> _saveToHistory() async {
    if (_imageFile == null || _diseaseName == null) return;
    
    final record = HistoryRecord(
      diseaseName: _diseaseName!,
      confidence: _confidence ?? 0.0,
      imagePath: _imageFile!.path,
      symptom: _symptom ?? '',
      advice: (_advice ?? []).join('\n'),
      createdAt: DateTime.now(),
    );
    
    await DatabaseHelper.instance.insertRecord(record);
  }

  Future<void> _uploadImage(File imageFile) async {
    setState(() {
      _isLoading = true;
      _diseaseName = null;
      _confidence = null;
      _symptom = null;
      _advice = null;
    });

    try {
      final compressedBytes = await _compressImage(imageFile);
      final uri = Uri.parse('http://10.0.2.2:5000/predict');
      final request = http.MultipartRequest('POST', uri);
      request.files.add(http.MultipartFile.fromBytes(
        'image',
        compressedBytes,
        filename: 'plant.jpg',
      ));

      final response = await request.send();
      final responseData = await response.stream.bytesToString();
      final result = json.decode(responseData);

      if (result['success'] == true) {
        setState(() {
          _diseaseName = result['disease'];
          _confidence = result['confidence'];
          _symptom = result['symptom'];
          _advice = List<String>.from(result['advice'] ?? []);
        });
        await _saveToHistory();
      } else {
        _showError(result['error'] ?? '识别失败');
      }
    } catch (e) {
      _showError('网络错误: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  Future<void> _takePicture() async {
    if (_cameraController == null || !_cameraController!.value.isInitialized) {
      await _initCamera();
      if (_cameraController == null) return;
    }

    try {
      final image = await _cameraController!.takePicture();
      final imageFile = File(image.path);
      setState(() => _imageFile = imageFile);
      await _uploadImage(imageFile);
    } catch (e) {
      _showError('拍照失败: $e');
    }
  }

  Future<void> _pickImage() async {
    final status = await Permission.photos.request();
    if (!status.isGranted) {
      _showError('需要相册权限');
      return;
    }

    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery);
    if (picked != null) {
      final imageFile = File(picked.path);
      setState(() => _imageFile = imageFile);
      await _uploadImage(imageFile);
    }
  }

  void _reset() {
    setState(() {
      _imageFile = null;
      _diseaseName = null;
      _confidence = null;
      _symptom = null;
      _advice = null;
    });
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('植物病害识别'),
        actions: [
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: () => Navigator.pushNamed(context, '/history'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildImagePreview(),
            const SizedBox(height: 24),
            _buildActionButtons(),
            const SizedBox(height: 24),
            if (_isLoading) const Center(child: CircularProgressIndicator()),
            if (_diseaseName != null && !_isLoading) _buildResultCard(),
          ],
        ),
      ),
    );
  }

  Widget _buildImagePreview() {
    return Container(
      height: 300,
      decoration: BoxDecoration(
        color: Colors.grey[200],
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey[300]!),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: _imageFile != null
            ? Image.file(_imageFile!, fit: BoxFit.cover)
            : const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.image, size: 80, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('请拍照或选择图片', style: TextStyle(color: Colors.grey)),
                ],
              ),
      ),
    );
  }

  Widget _buildActionButtons() {
    return Row(
      children: [
        Expanded(
          child: ElevatedButton.icon(
            onPressed: _isLoading ? null : _takePicture,
            icon: const Icon(Icons.camera_alt),
            label: const Text('拍照'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton.icon(
            onPressed: _isLoading ? null : _pickImage,
            icon: const Icon(Icons.photo_library),
            label: const Text('相册'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
              backgroundColor: Colors.orange,
            ),
          ),
        ),
        if (_imageFile != null) ...[
          const SizedBox(width: 12),
          IconButton(
            onPressed: _reset,
            icon: const Icon(Icons.refresh, color: Colors.red),
          ),
        ],
      ],
    );
  }

  Widget _buildResultCard() {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '识别结果',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(Icons.healing, color: Colors.green, size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    _diseaseName ?? '',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Text('置信度', style: TextStyle(fontSize: 16)),
            const SizedBox(height: 8),
            _buildConfidenceBar(),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                '${((_confidence ?? 0) * 100).toStringAsFixed(1)}%',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.green),
              ),
            ),
            const SizedBox(height: 20),
            const Text('症状描述', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            Text(
              _symptom ?? '',
              style: TextStyle(color: Colors.grey[600]),
            ),
            const SizedBox(height: 20),
            const Text('防治建议', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            ...(_advice ?? []).map((advice) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 18),
                  const SizedBox(width: 8),
                  Expanded(child: Text(advice, style: TextStyle(color: Colors.grey[700]))),
                ],
              ),
            )).toList(),
          ],
        ),
      ),
    );
  }

  Widget _buildConfidenceBar() {
    final value = _confidence ?? 0.0;
    Color barColor;
    if (value >= 0.8) {
      barColor = Colors.green;
    } else if (value >= 0.5) {
      barColor = Colors.orange;
    } else {
      barColor = Colors.red;
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: LinearProgressIndicator(
        value: value,
        minHeight: 16,
        backgroundColor: Colors.grey[200],
        valueColor: AlwaysStoppedAnimation<Color>(barColor),
      ),
    );
  }
}

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  List<HistoryRecord> _records = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadRecords();
  }

  Future<void> _loadRecords() async {
    final records = await DatabaseHelper.instance.getAllRecords();
    setState(() {
      _records = records;
      _isLoading = false;
    });
  }

  Future<void> _deleteRecord(int? id) async {
    if (id == null) return;
    await DatabaseHelper.instance.deleteRecord(id);
    _loadRecords();
  }

  Future<void> _clearAll() async {
    await DatabaseHelper.instance.deleteAllRecords();
    _loadRecords();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('识别历史'),
        actions: [
          if (_records.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_sweep),
              onPressed: () => _showClearDialog(),
            ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _records.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.history, size: 80, color: Colors.grey),
                      SizedBox(height: 16),
                      Text('暂无识别记录', style: TextStyle(color: Colors.grey, fontSize: 16)),
                    ],
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _records.length,
                  itemBuilder: (context, index) {
                    final record = _records[index];
                    return _buildHistoryCard(record);
                  },
                ),
    );
  }

  Widget _buildHistoryCard(HistoryRecord record) {
    final dateFormat = DateFormat('yyyy-MM-dd HH:mm');
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: () => _showDetailDialog(record),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(
                  File(record.imagePath),
                  width: 80,
                  height: 80,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) {
                    return Container(
                      width: 80,
                      height: 80,
                      color: Colors.grey[200],
                      child: const Icon(Icons.broken_image, color: Colors.grey),
                    );
                  },
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      record.diseaseName,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '置信度: ${(record.confidence * 100).toStringAsFixed(1)}%',
                      style: TextStyle(color: Colors.grey[600], fontSize: 14),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      dateFormat.format(record.createdAt),
                      style: TextStyle(color: Colors.grey[500], fontSize: 12),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: Colors.red),
                onPressed: () => _showDeleteDialog(record),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showDetailDialog(HistoryRecord record) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(record.diseaseName),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(
                  File(record.imagePath),
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) {
                    return Container(
                      height: 200,
                      color: Colors.grey[200],
                      child: const Icon(Icons.broken_image, color: Colors.grey, size: 60),
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),
              Text(
                '置信度: ${(record.confidence * 100).toStringAsFixed(1)}%',
                style: const TextStyle(fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 12),
              const Text('症状描述:', style: TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              Text(record.symptom, style: TextStyle(color: Colors.grey[600])),
              const SizedBox(height: 12),
              const Text('防治建议:', style: TextStyle(fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              ...record.advice.split('\n').map((a) => Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.check_circle, color: Colors.green, size: 16),
                    const SizedBox(width: 8),
                    Expanded(child: Text(a, style: TextStyle(color: Colors.grey[700]))),
                  ],
                ),
              )).toList(),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  void _showDeleteDialog(HistoryRecord record) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('确认删除'),
        content: const Text('确定要删除这条记录吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _deleteRecord(record.id);
            },
            child: const Text('删除', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  void _showClearDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('清空记录'),
        content: const Text('确定要清空所有识别记录吗？此操作不可恢复。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _clearAll();
            },
            child: const Text('清空', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }
}
