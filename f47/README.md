# Git 仓库分析器

使用 Tauri (Rust + Svelte + D3.js) 开发的桌面应用，用于分析本地 Git 仓库。

## 功能特性

- 选择本地 Git 仓库进行分析
- 可视化提交历史和贡献者活动热力图
- 统计每个作者的文件增删行数
- 代码增删的堆叠面积图展示
- 分析提交频率和贡献者统计

## 技术栈

### 后端 (Rust)
- **Tauri**: 桌面应用框架
- **git2**: Git 库绑定，用于解析 Git 仓库
- **serde**: 序列化/反序列化

### 前端
- **Svelte**: UI 框架
- **D3.js**: 数据可视化库
- **Vite**: 构建工具

## 项目结构

```
.
├── src/                     # 前端源代码
│   ├── main.js             # 入口文件
│   ├── App.svelte          # 主应用组件
│   └── components/
│       ├── Heatmap.svelte  # 贡献热力图组件
│       └── StackedArea.svelte # 堆叠面积图组件
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   └── main.rs         # 主程序，包含 Git 分析逻辑
│   ├── Cargo.toml          # Rust 依赖配置
│   └── tauri.conf.json     # Tauri 配置
├── package.json            # npm 依赖配置
├── vite.config.js          # Vite 配置
└── index.html              # HTML 入口
```

## 开发环境要求

- Node.js >= 16
- Rust >= 1.60
- Cargo

## 安装和运行

1. 安装 npm 依赖:
```bash
npm install
```

2. 运行开发模式:
```bash
npm run tauri dev
```

3. 构建生产版本:
```bash
npm run tauri build
```

## 使用说明

1. 启动应用后，点击"选择仓库"按钮
2. 在文件对话框中选择一个本地 Git 仓库目录
3. 等待分析完成（大仓库可能需要一些时间）
4. 查看统计概览、贡献热力图和代码增删堆叠面积图

## 功能详解

### Rust 后端功能

1. **仓库解析**: 使用 `git2` 库打开和解析 Git 仓库
2. **提交遍历**: 使用 `revwalk` 遍历所有提交历史
3. **差异计算**: 计算每次提交的代码行数变化（增加/删除）
4. **作者统计**: 聚合每个作者的提交次数和代码行数统计

### 前端可视化

1. **贡献热力图**: 类似 GitHub 的活动热力图，展示每日提交频率
2. **堆叠面积图**: 按作者展示随时间的代码净增加行数

## API 接口

### analyze_repo(path: &str) -> Result<AnalysisResult, String>

分析指定路径的 Git 仓库，返回提交列表和作者统计。

**返回数据结构**:
```json
{
  "commits": [
    {
      "id": "commit hash",
      "author": "作者名称",
      "email": "作者邮箱",
      "message": "提交信息",
      "timestamp": 1234567890,
      "lines_added": 100,
      "lines_deleted": 50
    }
  ],
  "author_stats": {
    "作者名": {
      "total_commits": 50,
      "total_lines_added": 1000,
      "total_lines_deleted": 500,
      "first_commit": 1234567890,
      "last_commit": 1234567890
    }
  }
}
```

## 许可证

MIT
