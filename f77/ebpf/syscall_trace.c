#include <uapi/linux/ptrace.h>
#include <linux/sched.h>
#include <linux/fs.h>

#define TASK_COMM_LEN 16
#define FILE_PATH_LEN 256

enum syscall_type {
    SYSCALL_OPEN = 0,
    SYSCALL_READ = 1,
    SYSCALL_WRITE = 2,
    SYSCALL_EXECVE = 3
};

enum event_state {
    STATE_ENTER = 0,
    STATE_EXIT = 1
};

struct event_data {
    u32 pid;
    u32 tgid;
    u64 timestamp;
    enum syscall_type syscall;
    enum event_state state;
    long retval;
    char comm[TASK_COMM_LEN];
    char filename[FILE_PATH_LEN];
    size_t count;
};

BPF_PERF_OUTPUT(events);

BPF_HASH(target_pids, u32, u8);

static inline int is_target_pid() {
    u32 tgid = bpf_get_current_pid_tgid() >> 32;
    u8 *target = target_pids.lookup(&tgid);
    return target != NULL;
}

static inline int bpf_read_user_str(char *dst, size_t size, const void __user *src) {
    if (!src || !dst || size == 0) {
        if (dst && size > 0) {
            dst[0] = '\0';
        }
        return -1;
    }

    int ret = bpf_probe_read_user(dst, size, src);
    if (ret == 0) {
        dst[size - 1] = '\0';
    } else {
        ret = bpf_probe_read(dst, size, src);
        if (ret == 0) {
            dst[size - 1] = '\0';
        } else {
            if (size > 0) {
                dst[0] = '\0';
            }
        }
    }
    return ret;
}

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_OPEN;
    data.state = STATE_ENTER;
    data.retval = 0;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));

    const char __user *filename = (const char __user *)args->filename;
    bpf_read_user_str(&data.filename, sizeof(data.filename), filename);
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_openat) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_OPEN;
    data.state = STATE_EXIT;
    data.retval = args->ret;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_READ;
    data.state = STATE_ENTER;
    data.retval = 0;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = args->count;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_read) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_READ;
    data.state = STATE_EXIT;
    data.retval = args->ret;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_write) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_WRITE;
    data.state = STATE_ENTER;
    data.retval = 0;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = args->count;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_write) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_WRITE;
    data.state = STATE_EXIT;
    data.retval = args->ret;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_execve) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_EXECVE;
    data.state = STATE_ENTER;
    data.retval = 0;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));

    const char __user *filename = (const char __user *)args->filename;
    bpf_read_user_str(&data.filename, sizeof(data.filename), filename);
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_execve) {
    if (!is_target_pid()) {
        return 0;
    }

    struct event_data data = {};
    u64 pid_tgid = bpf_get_current_pid_tgid();
    data.pid = pid_tgid;
    data.tgid = pid_tgid >> 32;
    data.timestamp = bpf_ktime_get_ns();
    data.syscall = SYSCALL_EXECVE;
    data.state = STATE_EXIT;
    data.retval = args->ret;
    bpf_get_current_comm(&data.comm, sizeof(data.comm));
    __builtin_memset(&data.filename, 0, sizeof(data.filename));
    data.count = 0;

    events.perf_submit(args, &data, sizeof(data));
    return 0;
}
