#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>
#include <linux/version.h>

#define TASK_COMM_LEN 16

struct event {
    u32 pid;
    char comm[TASK_COMM_LEN];
    s32 syscall_nr;
    u64 duration_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, u32);
    __type(value, u64);
} start_times SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(u32));
    __uint(value_size, sizeof(u32));
} events SEC(".maps");

const volatile s32 target_pid = -1;

struct trace_event_raw_sys_enter___compat {
    unsigned long long unused;
    long id;
    long args[6];
} __attribute__((preserve_access_index));

struct trace_event_raw_sys_exit___compat {
    unsigned long long unused;
    long id;
    long ret;
} __attribute__((preserve_access_index));

struct syscall_exit_args {
    unsigned long long unused;
    long syscall_nr;
    long ret;
} __attribute__((preserve_access_index));

static __always_inline s32 get_syscall_nr_from_exit(void *ctx) {
    const struct trace_event_raw_sys_exit *exit_ctx = ctx;
    s32 id = -1;

    if (bpf_core_field_exists(exit_ctx->id)) {
        id = BPF_CORE_READ(exit_ctx, id);
        if (id >= 0) {
            return id;
        }
    }

    const struct trace_event_raw_sys_exit___compat *compat_ctx = ctx;
    if (bpf_core_field_exists(compat_ctx->id)) {
        id = BPF_CORE_READ(compat_ctx, id);
        if (id >= 0) {
            return id;
        }
    }

    const struct syscall_exit_args *args_ctx = ctx;
    if (bpf_core_field_exists(args_ctx->syscall_nr)) {
        return BPF_CORE_READ(args_ctx, syscall_nr);
    }

    return -1;
}

struct syscall_enter_args {
    unsigned long long unused;
    long syscall_nr;
    long args[6];
} __attribute__((preserve_access_index));

static __always_inline s32 get_syscall_nr_from_enter(void *ctx) {
    const struct trace_event_raw_sys_enter *enter_ctx = ctx;
    s32 id = -1;

    if (bpf_core_field_exists(enter_ctx->id)) {
        id = BPF_CORE_READ(enter_ctx, id);
        if (id >= 0) {
            return id;
        }
    }

    const struct trace_event_raw_sys_enter___compat *compat_ctx = ctx;
    if (bpf_core_field_exists(compat_ctx->id)) {
        id = BPF_CORE_READ(compat_ctx, id);
        if (id >= 0) {
            return id;
        }
    }

    const struct syscall_enter_args *args_ctx = ctx;
    if (bpf_core_field_exists(args_ctx->syscall_nr)) {
        return BPF_CORE_READ(args_ctx, syscall_nr);
    }

    return -1;
}

SEC("tracepoint/syscalls/sys_enter")
int tracepoint_sys_enter(struct trace_event_raw_sys_enter *ctx) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 ts = bpf_ktime_get_ns();

    if (target_pid != -1 && pid != target_pid) {
        return 0;
    }

    bpf_map_update_elem(&start_times, &pid, &ts, BPF_ANY);
    return 0;
}

SEC("tracepoint/syscalls/sys_exit")
int tracepoint_sys_exit(struct trace_event_raw_sys_exit *ctx) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 *start_ts;
    u64 end_ts = bpf_ktime_get_ns();
    u64 duration;

    if (target_pid != -1 && pid != target_pid) {
        return 0;
    }

    start_ts = bpf_map_lookup_elem(&start_times, &pid);
    if (!start_ts) {
        return 0;
    }

    duration = end_ts - *start_ts;

    struct event ev = {};
    ev.pid = pid;
    ev.syscall_nr = get_syscall_nr_from_exit(ctx);
    ev.duration_ns = duration;
    bpf_get_current_comm(&ev.comm, sizeof(ev.comm));

    bpf_perf_event_output(ctx, &events, BPF_F_CURRENT_CPU, &ev, sizeof(ev));
    bpf_map_delete_elem(&start_times, &pid);

    return 0;
}

char LICENSE[] SEC("license") = "GPL";

char _version[] SEC("version") = LINUX_VERSION_CODE;
