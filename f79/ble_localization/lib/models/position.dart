class Position {
  final double x;
  final double y;
  final double accuracy;

  Position({
    required this.x,
    required this.y,
    this.accuracy = 0.0,
  });

  @override
  String toString() =>
      'Position{x: ${x.toStringAsFixed(2)}, y: ${y.toStringAsFixed(2)}, accuracy: ${accuracy.toStringAsFixed(2)}}';
}
