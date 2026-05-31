import 'dart:typed_data';

class IBeacon {
  final String uuid;
  final int major;
  final int minor;
  final int txPower;
  final int rssi;
  final String macAddress;
  final DateTime timestamp;

  IBeacon({
    required this.uuid,
    required this.major,
    required this.minor,
    required this.txPower,
    required this.rssi,
    required this.macAddress,
    required this.timestamp,
  });

  double get distance => _calculateDistance();

  double _calculateDistance() {
    if (rssi == 0) return -1.0;
    double ratio = rssi * 1.0 / txPower;
    if (ratio < 1.0) {
      return double.parse((pow(ratio, 10)).toStringAsFixed(2));
    } else {
      double accuracy =
          (0.89976) * double.parse((pow(ratio, 7.7095)).toStringAsFixed(2)) +
              0.111;
      return double.parse(accuracy.toStringAsFixed(2));
    }
  }

  num pow(num x, num exponent) {
    if (exponent == 0) return 1;
    num result = x;
    for (int i = 1; i < exponent; i++) {
      result *= x;
    }
    return result;
  }

  static IBeacon? fromAdvertisementData(
    List<int> manufacturerData,
    int rssi,
    String macAddress,
  ) {
    if (manufacturerData.length < 25) return null;

    ByteData data = ByteData.sublistView(Uint8List.fromList(manufacturerData));

    int appleId = data.getUint16(0, Endian.little);
    if (appleId != 0x004C) return null;

    int beaconType = data.getUint8(2);
    if (beaconType != 0x02) return null;

    int beaconLength = data.getUint8(3);
    if (beaconLength != 0x15) return null;

    String uuid = _parseUuid(data, 4);
    int major = data.getUint16(20, Endian.big);
    int minor = data.getUint16(22, Endian.big);
    int txPower = data.getInt8(24);

    return IBeacon(
      uuid: uuid,
      major: major,
      minor: minor,
      txPower: txPower,
      rssi: rssi,
      macAddress: macAddress,
      timestamp: DateTime.now(),
    );
  }

  static String _parseUuid(ByteData data, int offset) {
    return [
      data.getUint32(offset, Endian.big).toRadixString(16).padLeft(8, '0'),
      data.getUint16(offset + 4, Endian.big).toRadixString(16).padLeft(4, '0'),
      data.getUint16(offset + 6, Endian.big).toRadixString(16).padLeft(4, '0'),
      data.getUint16(offset + 8, Endian.big).toRadixString(16).padLeft(4, '0'),
      [
        data.getUint8(offset + 10).toRadixString(16).padLeft(2, '0'),
        data.getUint8(offset + 11).toRadixString(16).padLeft(2, '0'),
        data.getUint8(offset + 12).toRadixString(16).padLeft(2, '0'),
        data.getUint8(offset + 13).toRadixString(16).padLeft(2, '0'),
        data.getUint8(offset + 14).toRadixString(16).padLeft(2, '0'),
        data.getUint8(offset + 15).toRadixString(16).padLeft(2, '0'),
      ].join(),
    ].join('-');
  }

  @override
  String toString() {
    return 'IBeacon{uuid: $uuid, major: $major, minor: $minor, rssi: $rssi, distance: ${distance.toStringAsFixed(2)}m}';
  }
}
