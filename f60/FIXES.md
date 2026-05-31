# SSH 连接泄漏修复说明

## 问题描述

当监控超过 10 个服务实例时，工具运行一段时间后报错 `too many open files`。

## 根本原因分析

### 1. SSH 连接超时配置缺失
- 原 SSH 命令没有超时和保活配置
- 网络波动导致连接静默断开，但文件描述符未释放

### 2. 资源清理顺序错误
- 原代码先设置 `should_stop` 标志，再等待线程退出
- 但线程阻塞在 `readLine()` 上无法唤醒，导致线程挂死
- 文件描述符和子进程资源无法释放

### 3. 缺少连接状态检测
- 没有检测死连接并自动清理的机制
- 异常退出的 SSH 进程遗留文件描述符

## 修复内容

### 1. SSH 连接配置增强 (`ssh_reader.zig`)

**添加的 SSH 选项：**
```bash
-o ConnectTimeout=10          # 连接超时 10 秒
-o ServerAliveInterval=30     # 每 30 秒发送保活探测
-o ServerAliveCountMax=3      # 连续 3 次失败断开连接
-o StrictHostKeyChecking=no   # 跳过主机密钥检查
-o BatchMode=yes              # 禁用交互提示
-o LogLevel=ERROR             # 减少不必要的日志输出
```

### 2. 资源清理顺序修正 (`main.zig`)

**修复前（错误）：**
```zig
ctx.should_stop.store(true, .SeqCst);  // 1. 设置停止标志
ctx.thread.join();                     // 2. 等待线程（可能永远阻塞！）
ctx.reader.stop();                     // 3. 最后才终止进程
```

**修复后（正确）：**
```zig
ctx.should_stop.store(true, .SeqCst);  // 1. 设置停止标志
ctx.reader.stop();                     // 2. 先终止 SSH 进程，唤醒阻塞读取
ctx.thread.join();                     // 3. 现在线程可以正常退出
```

### 3. 添加运行状态跟踪 (`ssh_reader.zig`)

- 新增 `is_running` 标志，实时跟踪连接状态
- `readLine()` 检测到 EOF 或错误时自动设置 `is_running = false`
- 读取循环同时检查 `should_stop` 和 `is_running` 双标志

### 4. 新增连接管理器 (`connection_manager.zig`)

- 统一管理所有 SSH 连接
- 支持最大连接数限制（默认 50）
- 提供死连接清理功能
- 支持批量停止所有连接

### 5. 连接健康监控 (`main.zig`)

- 每 500ms 检查一次活跃连接数
- 所有连接断开时提前退出，避免空等
- 连接失败时正确统计和报告

### 6. 安全的进程终止 (`ssh_reader.zig`)

```zig
child.kill() catch {};           // 发送 SIGTERM
std.time.sleep(10 * ...);        // 等待 10ms 让进程响应
child.wait() catch {};           // 回收进程资源
child.deinit();                  // 关闭所有管道文件描述符
```

## 架构改进

### 清理流程对比

**修复前：**
```
设置停止标志 → 等待线程退出（阻塞）→ 无法到达的资源清理
                    ↓
             线程永久挂起
             文件描述符泄漏
             最终 too many open files
```

**修复后：**
```
设置停止标志 → 终止 SSH 进程 → 管道关闭 → readLine 返回 EOF
                                                      ↓
                                            线程正常退出
                                            资源完全释放
                                            无泄漏
```

## 最佳实践

1. **使用 `--demo` 或 `--local` 模式测试**：在部署到生产环境前，先用本地模式验证工具功能

2. **合理设置并发连接数**：建议单次运行监控不超过 20 个服务，避免超出系统文件描述符限制

3. **监控系统文件描述符限制**：
   ```bash
   # 查看当前限制
   ulimit -n
   
   # 临时增加限制（需要 root）
   ulimit -n 4096
   ```

4. **使用 SSH 密钥认证**：避免密码提示导致连接挂起

5. **定期更新工具**：后续版本会支持连接池和自动重连功能

## 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `src/ssh_reader.zig` | 添加 SSH 超时配置、连接状态跟踪、完善 stop() 方法 |
| `src/main.zig` | 修正资源清理顺序、添加连接健康监控、错误统计 |
| `src/connection_manager.zig` | 新增连接管理器模块 |

## 验证方法

1. 构建项目：
   ```bash
   zig build -Doptimize=ReleaseSafe
   ```

2. 运行演示模式验证基本功能：
   ```bash
   ./zig-out/bin/trace-cli --demo -t abc123def456
   ```

3. 使用 `lsof` 或 `procfs` 监控文件描述符使用情况：
   ```bash
   # 监控进程打开的文件数
   watch -n 1 'ls /proc/<pid>/fd | wc -l'
   ```

修复后，即使长时间运行并监控大量服务，文件描述符使用量也会保持稳定。
