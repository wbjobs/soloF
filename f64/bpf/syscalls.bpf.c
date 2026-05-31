//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#define TASK_COMM_LEN 16
#define MAX_ARGS 6
#define ARG_LEN 128

struct event {
    __u32 pid;
    __u32 tid;
    __u64 syscall_nr;
    char comm[TASK_COMM_LEN];
    __u64 args[MAX_ARGS];
    __s64 ret;
    __u8 is_exit;
    char pad[7];
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);
    __type(value, __u32);
} target_pids SEC(".maps");

struct syscall_args {
    __u64 args[MAX_ARGS];
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);
    __type(value, struct syscall_args);
} syscall_storage SEC(".maps");

static inline __u32 get_target_pid(__u32 pid) {
    __u32 *val = bpf_map_lookup_elem(&target_pids, &pid);
    return val ? *val : 0;
}

SEC("tracepoint/raw_syscalls/sys_enter")
int sys_enter(struct trace_event_raw_sys_enter *ctx) {
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 tid = (__u32)bpf_get_current_pid_tgid();

    if (!get_target_pid(pid)) {
        return 0;
    }

    struct syscall_args args = {};
    args.args[0] = ctx->args[0];
    args.args[1] = ctx->args[1];
    args.args[2] = ctx->args[2];
    args.args[3] = ctx->args[3];
    args.args[4] = ctx->args[4];
    args.args[5] = ctx->args[5];

    __u64 key = bpf_get_current_pid_tgid();
    bpf_map_update_elem(&syscall_storage, &key, &args, BPF_ANY);

    struct event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        return 0;
    }

    event->pid = pid;
    event->tid = tid;
    event->syscall_nr = ctx->id;
    event->is_exit = 0;
    event->ret = 0;
    __builtin_memcpy(event->args, args.args, sizeof(args.args));
    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    bpf_ringbuf_submit(event, 0);
    return 0;
}

SEC("tracepoint/raw_syscalls/sys_exit")
int sys_exit(struct trace_event_raw_sys_exit *ctx) {
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 tid = (__u32)bpf_get_current_pid_tgid();

    if (!get_target_pid(pid)) {
        return 0;
    }

    __u64 key = bpf_get_current_pid_tgid();
    struct syscall_args *args = bpf_map_lookup_elem(&syscall_storage, &key);

    struct event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
    if (!event) {
        return 0;
    }

    event->pid = pid;
    event->tid = tid;
    event->syscall_nr = ctx->id;
    event->is_exit = 1;
    event->ret = ctx->ret;
    if (args) {
        __builtin_memcpy(event->args, args->args, sizeof(args->args));
    } else {
        __builtin_memset(event->args, 0, sizeof(event->args));
    }
    bpf_get_current_comm(&event->comm, sizeof(event->comm));

    bpf_ringbuf_submit(event, 0);

    if (args) {
        bpf_map_delete_elem(&syscall_storage, &key);
    }

    return 0;
}

char LICENSE[] SEC("license") = "Dual BSD/GPL";
