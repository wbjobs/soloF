# BLE 室内定位应用

基于 Flutter 和 flutter_blue_plus 插件开发的跨平台 BLE 室内定位应用，使用加权质心算法（Weighted Centroid Localization）估算设备位置。

## 功能特性

- 扫描周围的 BLE 信标（iBeacon 协议）
- 解析 iBeacon 广播数据（UUID, Major, Minor, TxPower, RSSI）
- 根据 RSSI 信号强度计算到信标的距离
- 使用加权质心算法估算设备位置
- 可视化显示信标位置和估算位置
- 支持 Android/iOS/Windows 平台

## 技术栈

- **Flutter**: 跨平台 UI 框架
- **flutter_blue_plus**: BLE 扫描和连接插件
- **加权质心算法**: 室内定位算法

## 算法原理

### 加权质心定位算法

加权质心算法根据信标的信号强度（RSSI）计算权重，然后通过加权平均估算设备位置：

1. **距离计算**: 使用对数距离路径损耗模型，根据 RSSI 和 TxPower 估算设备到信标的距离
2. **权重计算**: 权重与距离的平方成反比 `w = 1 / d²`
3. **位置估算**: 
   ```
   X = (w1*x1 + w2*x2 + w3*x3) / (w1 + w2 + w3)
   Y = (w1*y1 + w2*y2 + w3*y3) / (w1 + w2 + w3)
   ```

### 信标配置

默认配置了三个信标坐标（可在 `lib/config/beacon_configs.dart` 中修改）：

| 信标 ID | X 坐标 | Y 坐标 |
|---------|--------|--------|
| 1       | 0      | 0      |
| 2       | 5      | 0      |
| 3       | 2.5    | 5      |

## 快速开始

### 前置要求

- Flutter SDK >= 3.0.0
- Android Studio / Xcode / Visual Studio
- 支持 BLE 的设备

### 安装依赖

```bash
flutter pub get
```

### 运行应用

```bash
flutter run
```

## 项目结构

```
lib/
├── main.dart                    # 应用入口
├── config/
│   └── beacon_configs.dart      # 信标坐标配置
├── models/
│   ├── ibeacon.dart             # iBeacon 数据模型
│   ├── beacon_config.dart       # 信标配置模型
│   └── position.dart            # 位置数据模型
├── services/
│   ├── ble_scanner_service.dart # BLE 扫描服务
│   └── weighted_centroid.dart   # 加权质心定位算法
└── pages/
    └── home_page.dart           # 主界面
```

## 平台配置

### Android

已在 `AndroidManifest.xml` 中配置以下权限：

- `BLUETOOTH_SCAN`
- `BLUETOOTH_CONNECT`
- `ACCESS_FINE_LOCATION` (Android 12 及以下)
- `BLUETOOTH` / `BLUETOOTH_ADMIN` (Android 11 及以下)

### iOS

已在 `Info.plist` 中配置以下权限：

- `NSBluetoothAlwaysUsageDescription`
- `NSBluetoothPeripheralUsageDescription`
- `NSLocationWhenInUseUsageDescription`

### Windows

flutter_blue_plus 插件原生支持 Windows，无需额外配置。

## 使用说明

1. 确保设备蓝牙已开启
2. 点击「开始扫描」按钮开始扫描 BLE 信标
3. 应用会自动识别 iBeacon 设备并显示在列表中
4. 当检测到至少 3 个配置的信标时，会自动计算并显示设备位置
5. 地图上蓝色圆点为已知信标位置，绿色圆点为估算的设备位置

## License

MIT
