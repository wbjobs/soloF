# Unity 2D RPG 游戏 - Mod系统

一个完整的Unity 2D RPG游戏项目，支持角色控制、对话系统和Mod热更新。

## 项目结构

```
f29/
├── UnityRPG/          # Unity游戏项目
│   └── Assets/
│       └── Scripts/
│           ├── Core/           # 核心系统
│           ├── ModSystem/      # Mod加载系统
│           ├── NPC/            # NPC系统
│           ├── Items/          # 物品系统
│           └── Networking/     # 网络通信
├── Mods/              # Mod配置文件夹（JSON文件）
└── Backend/           # Python FastAPI后端
    ├── main.py        # API主程序
    └── requirements.txt # Python依赖
```

## 功能特性

### 1. 角色控制系统
- **移动**: WASD键控制角色移动
- **攻击**: 鼠标左键进行攻击
- **对话**: 靠近NPC按E键开始对话

### 2. Mod系统
- 从 `Mods` 文件夹加载JSON配置文件
- 动态生成NPC和物品
- 支持NPC名称、对话内容、位置配置
- 支持物品属性配置（攻击、防御、价值等）

### 3. 后端API (FastAPI)
- `GET /api/mods` - 获取所有Mod列表
- `GET /api/mods/{mod_id}` - 获取指定Mod配置（支持热更新）
- `POST /api/mods` - 创建新Mod
- `PUT /api/mods/{mod_id}` - 更新Mod配置
- `DELETE /api/mods/{mod_id}` - 删除Mod
- `POST /api/reload` - 重新加载所有Mod

## 快速开始

### 后端启动

```bash
cd Backend
pip install -r requirements.txt
python main.py
```

API文档地址: http://localhost:8000/docs

### Unity项目设置

1. 在Unity中打开 `UnityRPG` 文件夹
2. 创建游戏场景并添加以下组件：

**玩家对象**:
- 添加 `PlayerController` 脚本
- 添加 `Rigidbody2D`（设置为重力为0）
- 添加 `Animator`（可选）
- 设置Tag为 "Player"

**管理器对象**:
- 创建空对象命名为 "GameManager"
- 添加 `ModLoader` 脚本
- 添加 `ModApiClient` 脚本
- 添加 `DialogueManager` 脚本
- 添加 `InventoryManager` 脚本

**对话UI**:
- 创建Canvas和对话面板
- 添加名字文本和对话文本
- 在 `DialogueManager` 中引用这些UI元素

### 创建自定义Mod

在 `Mods` 文件夹中创建JSON文件：

```json
{
  "modId": "my_mod",
  "modName": "我的Mod",
  "version": "1.0.0",
  "author": "我",
  "npcs": [
    {
      "id": "npc_001",
      "name": "我的NPC",
      "dialogueLines": ["你好！", "这是自定义对话"],
      "position": {"x": 0, "y": 0}
    }
  ],
  "items": [...]
}
```

## 热更新

1. 启动FastAPI后端
2. 运行Unity游戏
3. 修改 `Mods` 文件夹中的JSON文件
4. 游戏会每30秒自动从API拉取更新（可在 `ModApiClient` 中调整间隔）

## 核心脚本说明

| 脚本 | 功能 |
|------|------|
| PlayerController.cs | 角色移动、攻击、对话触发 |
| NPCController.cs | NPC行为和对话管理 |
| ModLoader.cs | 从JSON加载Mod，动态生成内容 |
| ModApiClient.cs | 与后端API通信，支持热更新 |
| DialogueManager.cs | 对话UI管理 |
| InventoryManager.cs | 背包物品管理 |
| ItemController.cs | 物品拾取和属性 |
