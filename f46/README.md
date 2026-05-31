# 地牢生成器 (Dungeon Generator)

这是一个使用 Godot 4 引擎和 Python 开发的 2D 地牢生成器。

## 项目结构

```
f46/
├── python/
│   ├── dungeon_generator.py  # 核心生成算法
│   ├── server.py             # Flask HTTP 服务器
│   ├── requirements.txt      # Python 依赖
│   └── start_server.bat      # Windows 启动脚本
├── godot/
│   ├── project.godot         # Godot 项目配置
│   ├── Main.tscn             # 主场景
│   ├── scripts/
│   │   ├── DungeonManager.gd  # 地牢管理器
│   │   └── UIPanel.gd         # UI 面板脚本
│   └── tiles/
│       ├── tileset.tres       # 瓦片集
│       ├── floor.svg          # 地板纹理
│       └── wall.svg           # 墙壁纹理
└── README.md                  # 本文件
```

## 功能特性

### Python 后端
- **元胞自动机算法**：基于 Conway's Game of Life 规则生成自然的洞穴效果
- **房间走廊算法**：生成随机房间并使用走廊连接
- **噪声算法**：使用 Perlin 噪声（简化版）生成地形
- **混合算法**：结合元胞自动机和房间走廊算法
- **形态学操作**：支持膨胀、腐蚀、开运算、闭运算
- **平滑处理**：边缘平滑优化

### Godot 前端
- **直观的 UI 控制面板**
  - 4 种生成方法选择
  - 地图尺寸调整（20-200）
  - 种子支持（可复现生成）
  - 详细参数调整滑块
- **TileMap 实时渲染**
- **HTTP 通信**

## 快速开始

### 1. 安装 Python 依赖

```bash
cd python
pip install -r requirements.txt
```

### 2. 启动 Python 服务器

```bash
python server.py
```

或在 Windows 上双击：
```
start_server.bat
```

服务器将在 `http://localhost:5000` 运行。

### 3. 打开 Godot 项目

1. 启动 Godot 4 引擎
2. 导入项目：选择 `godot/project.godot`
3. 点击 "运行" 按钮 (F5)

### 4. 使用方法

1. 确保 Python 服务器正在运行
2. 在 Godot 中选择生成方法
3. 调整参数（可选）
4. 点击 "生成地牢" 按钮
5. 查看生成结果！

## API 端点

### GET /health
检查服务器状态

### GET /methods
获取可用的生成方法和默认参数

### POST /generate
生成地牢

**请求体示例：**
```json
{
  "width": 80,
  "height": 60,
  "seed": 12345,
  "method": "hybrid",
  "params": {
    "fill_probability": 0.45,
    "ca_iterations": 5,
    "birth_limit": 4,
    "death_limit": 3,
    "room_min_size": 5,
    "room_max_size": 12,
    "num_rooms": 15,
    "corridor_width": 2
  }
}
```

**响应示例：**
```json
{
  "success": true,
  "dungeon": {
    "width": 80,
    "height": 60,
    "seed": 12345,
    "data": [[0, 1, 1, ...], ...]
  }
}
```

## 生成方法说明

### 1. 元胞自动机 (Cellular)
- **填充概率**：初始随机填充密度
- **迭代次数**：算法运行次数
- **出生阈值**：周围墙壁数量达到此值时变为墙
- **死亡阈值**：周围墙壁数量低于此值时变为空地

### 2. 房间走廊 (Rooms)
- **最小/最大房间尺寸**：房间大小范围
- **房间数量**：尝试生成的房间数
- **走廊宽度**：连接房间的走廊宽度

### 3. 噪声 (Noise)
- **噪声缩放**：噪声的缩放因子
- **八度**：噪声层数
- **持续度**：振幅衰减因子
- **间隙度**：频率增长因子
- **阈值**：生成墙壁的阈值

### 4. 混合 (Hybrid)
- 结合元胞自动机和房间走廊算法
- 同时支持两者的所有参数
- 生成既有自然洞穴又有人工建筑感的地牢

## 技术栈

- **Python 3.8+**
  - NumPy：数值计算
  - SciPy：形态学操作
  - Flask：HTTP 服务器
  - flask-cors：跨域支持

- **Godot 4.x**
  - GDScript
  - TileMap 系统
  - HTTPRequest

## 注意事项

1. **服务器必须先运行**：Godot 需要连接到 Python 服务器
2. **端口冲突**：确保 5000 端口未被占用
3. **性能**：生成大地图（>150x150）可能需要较长时间
4. **Python 版本**：建议使用 Python 3.8 或更高版本

## 故障排除

### 问题：连接失败
- 检查 Python 服务器是否正在运行
- 确认 `http://localhost:5000/health` 返回 `{"status": "ok"}`
- 检查防火墙设置

### 问题：瓦片显示异常
- 在 Godot 中重新导入瓦片纹理
- 确认 TileSet 配置正确

### 问题：参数调整无效
- 确保选择了正确的生成方法
- 检查 UI 脚本中的信号连接

## 未来改进

- [ ] 添加更多生成算法（迷宫、BSP 等）
- [ ] 支持导出为图片或地图文件
- [ ] 添加房间内容生成（宝箱、敌人等）
- [ ] 支持多层地牢
- [ ] 添加预览图生成
- [ ] 打包 Python 服务器为可执行文件
- [ ] 使用 GDExtension 替代 HTTP 通信

## 许可证

本项目仅供学习和研究使用。
