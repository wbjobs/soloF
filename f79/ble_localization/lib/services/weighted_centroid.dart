import '../models/ibeacon.dart';
import '../models/beacon_config.dart';
import '../models/position.dart';

class WeightedCentroidLocalization {
  final List<BeaconConfig> knownBeacons;

  WeightedCentroidLocalization({required this.knownBeacons});

  Position calculatePosition(List<IBeacon> detectedBeacons) {
    if (detectedBeacons.isEmpty) {
      return Position(x: 0, y: 0, accuracy: -1);
    }

    final matchedBeacons = <_BeaconMatch>[];
    for (var detected in detectedBeacons) {
      final config = _findMatchingConfig(detected);
      if (config != null) {
        matchedBeacons.add(_BeaconMatch(
          config: config,
          beacon: detected,
        ));
      }
    }

    if (matchedBeacons.length < 3) {
      return Position(
        x: 0,
        y: 0,
        accuracy: -1,
      );
    }

    final topThree = matchedBeacons
      ..sort((a, b) => b.beacon.rssi.compareTo(a.beacon.rssi))
      ..take(3).toList();

    return _calculateWeightedCentroid(topThree);
  }

  Position _calculateWeightedCentroid(List<_BeaconMatch> beacons) {
    double sumWeight = 0;
    double sumWeightedX = 0;
    double sumWeightedY = 0;

    for (var match in beacons) {
      final rssi = match.beacon.rssi;
      final distance = match.beacon.distance;

      final weight = _calculateWeight(rssi, distance);

      sumWeight += weight;
      sumWeightedX += weight * match.config.x;
      sumWeightedY += weight * match.config.y;
    }

    if (sumWeight == 0) {
      return Position(x: 0, y: 0, accuracy: -1);
    }

    final estimatedX = sumWeightedX / sumWeight;
    final estimatedY = sumWeightedY / sumWeight;

    final accuracy = _calculateAccuracy(beacons, estimatedX, estimatedY);

    return Position(
      x: estimatedX,
      y: estimatedY,
      accuracy: accuracy,
    );
  }

  double _calculateWeight(int rssi, double distance) {
    if (distance <= 0) {
      final normalizedRssi = (rssi + 100) / 100;
      return normalizedRssi * normalizedRssi;
    }
    return 1 / (distance * distance);
  }

  double _calculateAccuracy(
    List<_BeaconMatch> beacons,
    double estimatedX,
    double estimatedY,
  ) {
    if (beacons.isEmpty) return -1;

    double totalError = 0;
    for (var match in beacons) {
      final dx = estimatedX - match.config.x;
      final dy = estimatedY - match.config.y;
      final estimatedDistance = (dx * dx + dy * dy).toDouble();
      final actualDistance = match.beacon.distance;

      if (actualDistance > 0 && estimatedDistance > 0) {
        totalError += (estimatedDistance - actualDistance).abs();
      }
    }

    return totalError / beacons.length;
  }

  BeaconConfig? _findMatchingConfig(IBeacon beacon) {
    for (var config in knownBeacons) {
      if (beacon.uuid.toLowerCase() == config.identifier.toLowerCase() ||
          beacon.macAddress.toLowerCase() == config.identifier.toLowerCase() ||
          beacon.minor.toString() == config.identifier ||
          beacon.major.toString() == config.identifier) {
        return config;
      }
    }
    return null;
  }
}

class _BeaconMatch {
  final BeaconConfig config;
  final IBeacon beacon;

  _BeaconMatch({
    required this.config,
    required this.beacon,
  });
}
