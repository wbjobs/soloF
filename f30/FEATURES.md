# NetCDF Viewer 新功能文档

## 1. 颜色映射配置 (Colormap)

前端新增颜色映射选择下拉菜单，支持14种预设配色方案：

### 可用的 Colormap 选项：
- RdBu_r (默认) - 红蓝色调反转
- viridis - 蓝绿色渐变
- plasma - 紫黄渐变
- inferno - 黑红黄渐变
- magma - 黑红渐变
- cividis - 蓝黄渐变（色盲友好）
- jet - 彩虹色
- rainbow - 彩虹色
- coolwarm - 冷-暖色过渡
- bwr - 蓝-白-红
- seismic - 地震配色（蓝-白-红）
- terrain - 地形配色
- ocean - 海洋配色
- gist_earth - 地球配色

### 使用方法：
1. 在工具栏 "Colormap" 下拉菜单中选择配色方案
2. 图表会立即重新渲染，应用新的颜色映射

---

## 2. 经纬度范围过滤

后端 API 新增按经纬度范围裁剪数据的功能，减少数据传输量：

### API 端点：
```
GET /api/netcdf/data/{file_path}/{variable_name}?time={t}&lat={min,max}&lon={min,max}
```

### 参数说明：
- `lat` - 纬度范围，逗号分隔，例如：`lat=30,50`
- `lon` - 经度范围，逗号分隔，例如：`lon=110,140`
- 参数可选，不提供则返回全部数据

### 前端使用方法：
1. 在 "Lat Range" 输入框中输入最小和最大纬度
2. 在 "Lon Range" 输入框中输入最小和最大经度
3. 点击 "Apply Filter" 按钮
4. 图表会重新加载并显示指定范围内的数据

### 示例：
```
/api/netcdf/data/data.nc/temperature?time=0&lat=30,50&lon=110,140
```

### 后端实现细节：
- 使用 `np.where` 查找坐标数组中满足条件的索引范围
- 只返回裁剪后的数据数组和对应的坐标
- 无效或空的范围参数会被忽略
- 坐标数组也会相应裁剪，保证图表坐标轴正确

---

## 完整的 API 示例

### 获取元数据：
```
GET /api/netcdf/meta/data.nc
```

响应：
```json
{
  "filename": "data.nc",
  "dimensions": {
    "latitude": {"size": 50, "unlimited": false},
    "longitude": {"size": 100, "unlimited": false},
    "time": {"size": 24, "unlimited": true}
  },
  "variables": {
    "temperature": {
      "dimensions": ["time", "latitude", "longitude"],
      "shape": [24, 50, 100],
      "dtype": "float32",
      "attributes": {
        "units": "K",
        "long_name": "Temperature"
      }
    }
  },
  "global_attributes": {}
}
```

### 获取过滤后的数据：
```
GET /api/netcdf/data/data.nc/temperature?time=5&lat=30,50&lon=110,140
```

响应：
```json
{
  "name": "temperature",
  "dimensions": ["time", "latitude", "longitude"],
  "shape": [21, 37],
  "attributes": {
    "units": "K",
    "long_name": "Temperature"
  },
  "values": [[280.5, 281.2, ...], ...],
  "latitude": [30.2, 31.0, ...],
  "longitude": [110.7, 111.5, ...],
  "time": ["2024-01-01T05:00:00", ...],
  "time_index": 5
}
```

---

## 界面控件布局

```
┌───────────────────────────────────────────────────────────────────┐
│  NetCDF Meteorological Data Viewer                                 │
├───────────────────────────────────────────────────────────────────┤
│  Variable: [temperature ▼]  Colormap: [RdBu_r ▼]  Time: [=====]  │
├───────────────────────────────────────────────────────────────────┤
│  Lat Range: [30.0] - [50.0]  Lon Range: [110.0] - [140.0]  [Apply] │
├───────────────────────────────────────────────────────────────────┤
│  Variable: temperature     Dimensions: time, latitude, longitude   │
│  Shape: 21 x 37             Units: K                                │
├───────────────────────────────────────────────────────────────────┤
│                                                                     │
│                    [等值线图表区域]                                 │
│                                                                     │
│                                                                     │
└───────────────────────────────────────────────────────────────────┘
```
