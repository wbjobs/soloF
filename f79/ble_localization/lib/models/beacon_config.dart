class BeaconConfig {
  final String identifier;
  final double x;
  final double y;
  final String? description;
  final DateTime? updatedAt;
  final String? updatedBy;

  BeaconConfig({
    required this.identifier,
    required this.x,
    required this.y,
    this.description,
    this.updatedAt,
    this.updatedBy,
  });

  BeaconConfig copyWith({
    String? identifier,
    double? x,
    double? y,
    String? description,
    DateTime? updatedAt,
    String? updatedBy,
  }) {
    return BeaconConfig(
      identifier: identifier ?? this.identifier,
      x: x ?? this.x,
      y: y ?? this.y,
      description: description ?? this.description,
      updatedAt: updatedAt ?? this.updatedAt,
      updatedBy: updatedBy ?? this.updatedBy,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'identifier': identifier,
      'x': x,
      'y': y,
      'description': description,
      'updatedAt': updatedAt?.toIso8601String(),
      'updatedBy': updatedBy,
    };
  }

  factory BeaconConfig.fromJson(Map<String, dynamic> json) {
    return BeaconConfig(
      identifier: json['identifier'] as String,
      x: (json['x'] as num).toDouble(),
      y: (json['y'] as num).toDouble(),
      description: json['description'] as String?,
      updatedAt: json['updatedAt'] != null
          ? DateTime.parse(json['updatedAt'] as String)
          : null,
      updatedBy: json['updatedBy'] as String?,
    );
  }

  @override
  String toString() =>
      'BeaconConfig(id: $identifier, x: $x, y: $y, desc: $description)';
}
