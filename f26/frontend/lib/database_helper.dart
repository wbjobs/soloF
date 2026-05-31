import 'dart:io';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class HistoryRecord {
  final int? id;
  final String diseaseName;
  final double confidence;
  final String imagePath;
  final String symptom;
  final String advice;
  final DateTime createdAt;

  HistoryRecord({
    this.id,
    required this.diseaseName,
    required this.confidence,
    required this.imagePath,
    required this.symptom,
    required this.advice,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'disease_name': diseaseName,
      'confidence': confidence,
      'image_path': imagePath,
      'symptom': symptom,
      'advice': advice,
      'created_at': createdAt.toIso8601String(),
    };
  }

  factory HistoryRecord.fromMap(Map<String, dynamic> map) {
    return HistoryRecord(
      id: map['id'],
      diseaseName: map['disease_name'],
      confidence: map['confidence'],
      imagePath: map['image_path'],
      symptom: map['symptom'],
      advice: map['advice'],
      createdAt: DateTime.parse(map['created_at']),
    );
  }
}

class DatabaseHelper {
  static final DatabaseHelper instance = DatabaseHelper._init();
  static Database? _database;

  DatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('plant_disease_history.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        disease_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        image_path TEXT NOT NULL,
        symptom TEXT NOT NULL,
        advice TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    ''');
  }

  Future<int> insertRecord(HistoryRecord record) async {
    final db = await instance.database;
    return await db.insert('history', record.toMap());
  }

  Future<List<HistoryRecord>> getAllRecords() async {
    final db = await instance.database;
    final List<Map<String, dynamic>> maps = await db.query(
      'history',
      orderBy: 'created_at DESC',
    );
    return List.generate(maps.length, (i) => HistoryRecord.fromMap(maps[i]));
  }

  Future<int> deleteRecord(int id) async {
    final db = await instance.database;
    return await db.delete(
      'history',
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<int> deleteAllRecords() async {
    final db = await instance.database;
    return await db.delete('history');
  }

  Future close() async {
    final db = await instance.database;
    db.close();
  }
}
