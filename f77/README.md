# eBPF 系统调用监控可视化系统

基于 eBPF (BCC) 的系统调用监控系统，实时监控进程的 open、read、write、execve 系统调用，并通过 WebSocket 推送到前端，使用 React + XState 进行状态流转可视化。**支持异常检测和自动响应功能。

## 系统架构

```
┌─────────────────┐     Perf Event     ┌─────────────────┐
│  Linux Kernel   │◄──────────────────►│  eBPF Program   │
│  (Tracepoints)  │                    │  (syscall_trace.c)
└─────────────────┘                    └─────────────────┘
                                              │
                                              ▼
┌─────────────────┐     eBPF Map       ┌─────────────────┐
│   User Space    │◄──────────────────►│  BCC / Python   │
│                 │                    │  Backend        │
└─────────────────┘                    └─────────────────┘
                                              │
                                              ▼
                                      ┌─────────────────┐
                                      │  WebSocket      │
                                      │  Server (:8080) │
                                      └─────────────────┘
                                              │
                                              ▼
                                      ┌─────────────────┐
                                      │  React Frontend │
                                      │  (:3000)        │
                                      │  - XState       │
                                      │  - State Graph  │
                                      └─────────────────┘
```

## 目录结构

```
.
├── ebpf/
│   └── syscall_trace.c          # eBPF 内核态程序
├── backend/
│   ├── main.py                  # 真实 eBPF 后端服务
│   ├── mock_server.py           # 模拟数据后端服务（非 Linux 环境使用）
│   └── requirements.txt         # Python 依赖
└── frontend/
    ├── src/
    │   ├── components/          # React 组件
    │   │   ├── PidControl.tsx       # PID 控制面板
    │   │   ├── StatsPanel.tsx       # 统计面板
    │   │   ├── StateTransitionGraph.tsx  # 状态流转图
    │   │   └── EventLog.tsx         # 事件日志
    │   ├── types.ts             # TypeScript 类型定义
    │   ├── stateMachine.ts      # XState 状态机
    │   ├── useWebSocket.ts      # WebSocket Hook
    │   ├── App.tsx              # 主应用组件
    │   ├── main.tsx             # 入口文件
    │   └── index.css            # 样式
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    └── postcss.config.js
```

## 快速开始

### 前置要求

**Linux 环境（真实 eBPF 模式）：**
- Linux Kernel >= 4.15 (支持 eBPF)
- Python 3.8+
- BCC (BPF Compiler Collection) 已安装
- root 权限
- Node.js 18+

**非 Linux 环境（模拟模式）：**
- Python 3.8+
- Node.js 18+

### 1. 启动后端服务

#### Linux 环境（真实 eBPF）

```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动服务（需要 root 权限）
sudo python3 main.py --port 8080

# 或指定初始监控的 PID
sudo python3 main.py --port 8080 --pid 1234 --pid 5678
```

#### 非 Linux 环境（模拟模式）

```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动模拟服务
python3 mock_server.py --port 8080

# 或指定初始模拟 PID
python3 mock_server.py --port 8080 --pid 1000 --pid 2000
```

### 2. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000 查看可视化界面。

## 使用说明

### 添加监控进程

1. 在前端页面的"进程监控控制"区域输入要监控的 PID
2. 点击"添加监控"按钮
3. 系统会开始捕获该进程的 open、read、write 系统调用

### 查看状态流转

1. 添加监控 PID 后，在"选择进程查看状态流转图"区域点击进程按钮
2. 状态流转图会显示该进程的系统调用状态转换
3. 节点表示系统调用状态（OPEN/READ/WRITE 的 Enter/Exit）
4. 箭头表示状态转换，标注转换次数和平均耗时

### 查看统计信息

- 顶部统计面板显示全局的系统调用计数和数据量
- 进程列表显示每个被监控进程的调用统计

### 查看事件日志

- 右侧事件日志实时显示所有系统调用事件
- 包含时间戳、PID、系统调用类型、状态、参数等信息

## API 接口

### WebSocket 接口 (`ws://localhost:8080/ws`)

**客户端发送消息：**

```json
// 添加监控 PID
{"type": "add_pid", "pid": 1234}

// 移除监控 PID
{"type": "remove_pid", "pid": 1234}

// 获取监控 PID 列表
{"type": "list_pids"}
```

**服务端推送消息：**

```json
// 系统调用事件
{
  "type": "syscall_event",
  "data": {
    "pid": 1234,
    "tgid": 1234,
    "timestamp": 1234567890000000000,
    "syscall": "open",
    "state": "enter",
    "retval": 0,
    "comm": "bash",
    "filename": "/etc/passwd",
    "count": 0
  }
}
```

### HTTP 接口

- `GET /health` - 健康检查
- `GET /api/pids` - 获取监控 PID 列表
- `POST /api/pids` - 添加监控 PID (`{"pid": 1234}`)
- `DELETE /api/pids` - 移除监控 PID (`{"pid": 1234}`)

## eBPF 程序说明

### 监控的系统调用

| 系统调用 | 说明 | Tracepoint |
|---------|------|------------|
| openat  | 打开文件 | sys_enter_openat, sys_exit_openat |
| read    | 读取数据 | sys_enter_read, sys_exit_read |
| write   | 写入数据 | sys_enter_write, sys_exit_write |

### eBPF Map

- `target_pids`: HASH 映射，存储需要监控的 PID
- `events`: PERF 输出缓冲区，用于向用户态推送事件

### 事件数据结构

```c
struct event_data {
    u32 pid;           // 线程 ID
    u32 tgid;          // 进程 ID (TGID)
    u64 timestamp;     // 时间戳 (ns)
    enum syscall_type syscall;  // 系统调用类型
    enum event_state state;     // 状态 (enter/exit)
    long retval;       // 返回值 (仅 exit 状态有效)
    char comm[16];     // 进程名
    char filename[256];// 文件名 (仅 open enter 有效)
    size_t count;      // 读写字节数 (仅 read/write enter 有效)
};
```

## XState 状态机说明

前端使用 XState 状态机管理系统调用状态：

### 状态机状态

- `idle`: 空闲状态，等待事件
- `monitoring`: 监控状态，正在处理系统调用事件

### 事件

- `SYSCALL_RECEIVED`: 收到系统调用事件
- `ADD_PROCESS`: 添加进程
- `REMOVE_PROCESS`: 移除进程
- `CLEAR_LOG`: 清空日志

### Context 上下文

- `processes`: Map<pid, ProcessState> - 进程状态映射
- `eventLog`: SyscallEvent[] - 事件日志
- `pendingOpens/Reads/Writes`: 跟踪未完成的系统调用

## 故障排查

### 后端服务无法启动

1. 确认是否为 Linux 环境且内核版本 >= 4.15
2. 确认 BCC 已正确安装：`dpkg -l | grep bcc`
3. 确认有 root 权限运行
4. 检查是否有其他进程占用 8080 端口

### 前端无法连接 WebSocket

1. 确认后端服务已启动
2. 检查浏览器控制台是否有连接错误
3. 确认 Vite 代理配置正确

### 没有收到系统调用事件

1. 确认已添加要监控的 PID
2. 确认被监控进程正在执行 open/read/write 操作
3. 检查后端日志是否有错误信息

## 许可证

MIT License
