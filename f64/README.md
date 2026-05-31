# sysmon - eBPF System Call Monitor

A command-line tool written in Go that uses eBPF technology to monitor system calls of a specified process.

## Features

- Monitor system calls of a specific process by PID
- Monitor processes by name
- Real-time display of system call names, arguments, and return values
- Support for following child processes and threads
- Support for showing both entry and exit events
- **Thread-aware output**: Each thread is displayed with its unique TID
- **Color-coded threads**: Different threads use different colors for easy identification
- **Timestamp support**: Optional timestamps for each event
- **Thread grouping**: Optional buffered output grouped by thread

## Requirements

### Linux Kernel
- Linux kernel 5.8 or later (for BPF ring buffer support)
- Kernel compiled with BPF support (CONFIG_BPF=y)
- Kernel compiled with BTF support (CONFIG_DEBUG_INFO_BTF=y)
- Kernel compiled with tracepoint support

### Build Dependencies
- Go 1.21 or later
- Clang/LLVM 11 or later
- libbpf-dev (or libbpf from source)
- bpftool (for generating vmlinux.h)
- make

### Runtime Dependencies
- Root privileges (required for loading BPF programs)
- Kernel headers for your running kernel

## Build Instructions

### Step 1: Generate vmlinux.h

First, generate the vmlinux.h header file from your running kernel:

```bash
bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h
```

Or install kernel headers and use:

```bash
apt-get install linux-headers-$(uname -r)
```

### Step 2: Build the project

```bash
make
```

This will:
1. Generate BPF Go bindings using `go generate`
2. Build the sysmon binary

Or manually:

```bash
go generate ./...
go build -o sysmon .
```

## Usage

### Monitor a process by PID

```bash
sudo ./sysmon -p 1234
```

### Monitor a process by name

```bash
sudo ./sysmon -c nginx
```

### Show both entry and exit events

```bash
sudo ./sysmon -p 1234 -e
```

### Follow child processes and threads

```bash
sudo ./sysmon -p 1234 -f
```

### Disable thread ID display

```bash
sudo ./sysmon -p 1234 -t=false
```

### Disable color output

```bash
sudo ./sysmon -p 1234 -color=false
```

### Group output by thread (buffered)

```bash
sudo ./sysmon -p 1234 -g
```

### Disable timestamps

```bash
sudo ./sysmon -p 1234 -T=false
```

### JSON output format (for programmatic parsing)

```bash
sudo ./sysmon -p 1234 -o json
```

### JSON output with entry events

```bash
sudo ./sysmon -p 1234 -o json -e
```

### Combine options (recommended for multi-threaded programs)

```bash
sudo ./sysmon -p 1234 -f -e
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p <pid>` | Target PID to monitor | 0 (required) |
| `-c <name>` | Target process name (comm) to monitor | "" |
| `-e` | Show syscall entry events | false |
| `-f` | Follow forks and threads | false |
| `-t` | Show thread ID (TID) in output | true |
| `-color` | Enable color output for different threads | true |
| `-T` | Show timestamp in output | true |
| `-g` | Group output by thread (buffered, flushed on exit) | false |
| `-o <format>` | Output format: text or json | text |
| `-h` | Show help message | - |

## Output Format

Default output with timestamps and TID (colors enabled in terminal):
```
[15:04:05.123456 TID=12345] openat(dirfd=-100, pathname="test.txt", flags=O_RDONLY|O_CLOEXEC, mode=0) = 3
[15:04:05.123478 TID=12346] mmap(addr=NULL, length=4096, prot=PROT_READ|PROT_WRITE, flags=MAP_PRIVATE|MAP_ANONYMOUS, fd=-1, offset=0) = 0x7f8a12340000
[15:04:05.123489 TID=12345] read(fd=3, buf=0x55f8a0, count=4096) = 1024
[15:04:05.123501 TID=12347] socket(domain=AF_INET, type=SOCK_STREAM, protocol=0) = 4
```

With `-e` flag (entry and exit events):
```
[15:04:05.123456 TID=12345] openat(dirfd=-100, pathname="test.txt", flags=O_RDONLY|O_CLOEXEC, mode=0) →
[15:04:05.123458 TID=12345] openat(dirfd=-100, pathname="test.txt", flags=O_RDONLY|O_CLOEXEC, mode=0) = 3
```

With `-g` flag (grouped by thread, output flushed on exit):
```
=== Thread 12345 ===
[15:04:05.123456 TID=12345] openat(dirfd=-100, pathname="test.txt", flags=O_RDONLY|O_CLOEXEC, mode=0) = 3
[15:04:05.123489 TID=12345] read(fd=3, buf=0x55f8a0, count=4096) = 1024
[15:04:05.123510 TID=12345] write(fd=1, buf=0x55f8a0, count=1024) = 1024

=== Thread 12346 ===
[15:04:05.123478 TID=12346] mmap(addr=NULL, length=4096, prot=PROT_READ|PROT_WRITE, flags=MAP_PRIVATE|MAP_ANONYMOUS, fd=-1, offset=0) = 0x7f8a12340000

=== Thread 12347 ===
[15:04:05.123501 TID=12347] socket(domain=AF_INET, type=SOCK_STREAM, protocol=0) = 4
```

The output format shows:
- `[HH:MM:SS.microsec]` - Timestamp (optional, enabled by default)
- `TID=xxxxx` - Thread ID (optional, enabled by default, color-coded)
- `syscall_name(...)` - System call with named arguments
- `→` - Syscall entry event (with `-e` flag)
- `= value` - Return value (with error description if negative)

## JSON Output Format

When using `-o json`, each line is a standalone JSON object (JSON Lines format), suitable for programmatic parsing.

**Exit event example:**
```json
{
  "timestamp": "2024-01-15T15:04:05.123456789+08:00",
  "pid": 12345,
  "tid": 12345,
  "comm": "cat",
  "syscall": "openat",
  "syscall_nr": 257,
  "is_exit": true,
  "args": [
    {"name": "dirfd", "value": "-100"},
    {"name": "pathname", "value": "\"test.txt\""},
    {"name": "flags", "value": "O_RDONLY|O_CLOEXEC"},
    {"name": "mode", "value": "0"}
  ],
  "ret": 3,
  "ret_str": "3"
}
```

**Entry event example (with `-e` flag):**
```json
{
  "timestamp": "2024-01-15T15:04:05.123456789+08:00",
  "pid": 12345,
  "tid": 12345,
  "comm": "cat",
  "syscall": "openat",
  "syscall_nr": 257,
  "is_exit": false,
  "args": [
    {"name": "dirfd", "value": "-100"},
    {"name": "pathname", "value": "\"test.txt\""},
    {"name": "flags", "value": "O_RDONLY|O_CLOEXEC"},
    {"name": "mode", "value": "0"}
  ]
}
```

**Error event example:**
```json
{
  "timestamp": "2024-01-15T15:04:05.123456789+08:00",
  "pid": 12345,
  "tid": 12345,
  "comm": "cat",
  "syscall": "openat",
  "syscall_nr": 257,
  "is_exit": true,
  "args": [
    {"name": "dirfd", "value": "-100"},
    {"name": "pathname", "value": "\"/nonexistent\""},
    {"name": "flags", "value": "O_RDONLY"},
    {"name": "mode", "value": "0"}
  ],
  "ret": -2,
  "ret_str": "-1 (no such file or directory)",
  "error": "no such file or directory"
}
```

### JSON Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp with nanosecond precision |
| `pid` | uint32 | Process ID |
| `tid` | uint32 | Thread ID |
| `comm` | string | Process name (comm) |
| `syscall` | string | System call name |
| `syscall_nr` | uint64 | System call number |
| `is_exit` | boolean | `true` for exit events, `false` for entry events |
| `args` | array | Array of argument objects with `name` and `value` |
| `ret` | int64 | Raw return value (only for exit events) |
| `ret_str` | string | Formatted return value (only for exit events) |
| `error` | string | Error description if syscall failed (only for exit events with errors) |

### Parsing JSON Output with jq

```bash
# Count system calls by type
sudo ./sysmon -p 1234 -o json | jq -s 'group_by(.syscall) | map({syscall: .[0].syscall, count: length}) | sort_by(-.count)'

# Filter only failed system calls
sudo ./sysmon -p 1234 -o json | jq 'select(.error != null)'

# Extract all file paths from openat calls
sudo ./sysmon -p 1234 -o json | jq -r 'select(.syscall == "openat") | .args[] | select(.name == "pathname") | .value'

# Count system calls per thread
sudo ./sysmon -p 1234 -o json | jq -s 'group_by(.tid) | map({tid: .[0].tid, count: length})'
```

## Supported System Calls

The tool supports monitoring all system calls available on your Linux kernel, with special formatting for:

- File operations: open, openat, read, write, close, pread64, pwrite64, readv, writev, etc.
- File system operations: stat, fstat, lstat, newfstatat, access, chmod, chown, etc.
- Directory operations: getdents64, mkdir, rmdir, rename, link, unlink, etc.
- Memory operations: mmap, mprotect, munmap, mremap, brk, etc.
- Process operations: fork, vfork, clone, execve, execveat, exit, exit_group, etc.
- Network operations: socket, connect, bind, listen, accept, sendto, recvfrom, etc.
- IPC operations: pipe, pipe2, mq_open, shmget, semget, msgget, etc.
- Time operations: clock_gettime, nanosleep, timerfd_create, etc.
- And many more...

## How It Works

sysmon uses eBPF tracepoints attached to the kernel's raw_syscalls:sys_enter and raw_syscalls:sys_exit tracepoints:

1. **eBPF Program**: Loaded into the kernel, it filters events based on target PID/process name
2. **Ring Buffer**: Events are efficiently transferred from kernel to user space using BPF ring buffer
3. **User Space**: Go program reads events, formats them, and displays them in real-time

## Troubleshooting

### Permission denied

Make sure you run the program with root privileges:
```bash
sudo ./sysmon -p 1234
```

### BPF program load failed

Check if your kernel supports BPF:
```bash
zcat /proc/config.gz | grep CONFIG_BPF
```

Check for BTF support:
```bash
ls /sys/kernel/btf/vmlinux
```

### Could not find kernel headers

Install kernel headers for your running kernel:
```bash
# Debian/Ubuntu
sudo apt-get install linux-headers-$(uname -r)

# RHEL/CentOS
sudo yum install kernel-devel-$(uname -r)

# Fedora
sudo dnf install kernel-devel-$(uname -r)
```

### Missing vmlinux.h

Generate vmlinux.h from your kernel:
```bash
bpftool btf dump file /sys/kernel/btf/vmlinux format c > bpf/vmlinux.h
```

## Performance Considerations

- The tool only monitors specified processes, minimizing overhead
- BPF ring buffer provides efficient zero-copy data transfer
- String arguments are read using ptrace, which adds some overhead
- For high-throughput processes, consider monitoring only exit events (default)

## Security

- Requires root privileges to load BPF programs
- Does not modify system behavior, only monitors
- All monitoring is performed in-kernel for efficiency

## License

Dual BSD/GPL (same as the Linux kernel BPF samples)
