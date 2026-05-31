#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_ringbuf.h>

char LICENSE[] SEC("license") = "Dual BSD/GPL";

#define TARGET_PORT 8080
#define EVENT_TYPE_CONNECT 0
#define EVENT_TYPE_RECV 1
#define RINGBUF_SIZE (16 * 1024 * 1024)
#define TASK_COMM_LEN 16

struct proc_info {
    __u32 pid;
    char comm[TASK_COMM_LEN];
} __attribute__((packed));

struct sock_info {
    struct proc_info client;
    struct proc_info server;
    __u8 is_client_set;
    __u8 is_server_set;
} __attribute__((packed));

struct event {
    __u32 type;
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u16 sport;
    __u16 dport;
    __u64 timestamp;
    __u64 cookie;
    char comm[TASK_COMM_LEN];
    struct proc_info src_process;
    struct proc_info dst_process;
} __attribute__((packed));

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, RINGBUF_SIZE);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 65536);
    __type(key, __u64);
    __type(value, struct sock_info);
} sock_proc_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 65536);
    __type(key, __u64);
    __type(value, __u8);
} seen_connections SEC(".maps");

static __always_inline int is_target_port(__u16 port) {
    return port == bpf_htons(TARGET_PORT);
}

static __always_inline void get_current_comm(char *buf, size_t size) {
    bpf_get_current_comm(buf, size);
}

static __always_inline void send_event(void *ctx, __u32 type, struct sock *sk) {
    struct event *e;
    __u16 sport, dport;
    __u32 saddr, daddr;
    __u64 cookie = bpf_get_socket_cookie(sk);
    __u32 pid = bpf_get_current_pid_tgid() >> 32;

    e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e) {
        return;
    }

    e->type = type;
    e->pid = pid;
    e->timestamp = bpf_ktime_get_ns();
    e->cookie = cookie;
    __builtin_memset(e->comm, 0, TASK_COMM_LEN);
    get_current_comm(e->comm, TASK_COMM_LEN);

    BPF_CORE_READ_INTO(&saddr, sk, __sk_common.skc_rcv_saddr);
    BPF_CORE_READ_INTO(&daddr, sk, __sk_common.skc_daddr);
    BPF_CORE_READ_INTO(&sport, sk, __sk_common.skc_num);
    BPF_CORE_READ_INTO(&dport, sk, __sk_common.skc_dport);

    e->saddr = saddr;
    e->daddr = daddr;
    e->sport = sport;
    e->dport = bpf_ntohs(dport);

    __builtin_memset(&e->src_process, 0, sizeof(e->src_process));
    __builtin_memset(&e->dst_process, 0, sizeof(e->dst_process));

    struct sock_info *si = bpf_map_lookup_elem(&sock_proc_map, &cookie);
    if (si) {
        if (sport == bpf_htons(TARGET_PORT)) {
            __builtin_memcpy(&e->src_process, &si->client, sizeof(si->client));
            __builtin_memcpy(&e->dst_process, &si->server, sizeof(si->server));
        } else {
            __builtin_memcpy(&e->src_process, &si->server, sizeof(si->server));
            __builtin_memcpy(&e->dst_process, &si->client, sizeof(si->client));
        }
    } else {
        e->src_process.pid = pid;
        __builtin_memcpy(e->src_process.comm, e->comm, TASK_COMM_LEN);
    }

    bpf_ringbuf_submit(e, 0);
}

SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(tcp_v4_connect, struct sock *sk) {
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != 2)
        return 0;

    __u64 cookie = bpf_get_socket_cookie(sk);
    __u32 pid = bpf_get_current_pid_tgid() >> 32;

    struct sock_info si = {};
    si.client.pid = pid;
    get_current_comm(si.client.comm, TASK_COMM_LEN);
    si.is_client_set = 1;

    bpf_map_update_elem(&sock_proc_map, &cookie, &si, BPF_ANY);

    return 0;
}

SEC("kprobe/inet_csk_accept")
int BPF_KPROBE(inet_csk_accept, struct sock *sk) {
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != 2)
        return 0;

    __u16 sport = BPF_CORE_READ(sk, __sk_common.skc_num);
    if (!is_target_port(sport))
        return 0;

    __u64 cookie = bpf_get_socket_cookie(sk);
    __u32 pid = bpf_get_current_pid_tgid() >> 32;

    struct sock_info *sip = bpf_map_lookup_elem(&sock_proc_map, &cookie);
    struct sock_info si;

    if (sip) {
        si = *sip;
    } else {
        __builtin_memset(&si, 0, sizeof(si));
    }

    si.server.pid = pid;
    get_current_comm(si.server.comm, TASK_COMM_LEN);
    si.is_server_set = 1;

    bpf_map_update_elem(&sock_proc_map, &cookie, &si, BPF_ANY);

    return 0;
}

SEC("tracepoint/sock/inet_sock_set_state")
int tracepoint_inet_sock_set_state(struct trace_event_raw_inet_sock_set_state *ctx) {
    struct sock *sk = (struct sock *)ctx->skaddr;
    __u16 family = ctx->family;
    __u8 newstate = ctx->newstate;

    if (family != 2)
        return 0;

    __u64 cookie = bpf_get_socket_cookie(sk);

    if (newstate == TCP_SYN_SENT) {
        __u32 pid = bpf_get_current_pid_tgid() >> 32;
        struct sock_info si = {};
        si.client.pid = pid;
        get_current_comm(si.client.comm, TASK_COMM_LEN);
        si.is_client_set = 1;
        bpf_map_update_elem(&sock_proc_map, &cookie, &si, BPF_ANY);
    }

    if (newstate == TCP_SYN_RECV) {
        __u16 sport = ctx->sport;
        if (is_target_port(sport)) {
            __u32 pid = bpf_get_current_pid_tgid() >> 32;
            struct sock_info *sip = bpf_map_lookup_elem(&sock_proc_map, &cookie);
            struct sock_info si;
            if (sip) {
                si = *sip;
            } else {
                __builtin_memset(&si, 0, sizeof(si));
            }
            si.server.pid = pid;
            get_current_comm(si.server.comm, TASK_COMM_LEN);
            si.is_server_set = 1;
            bpf_map_update_elem(&sock_proc_map, &cookie, &si, BPF_ANY);
        }
    }

    if (newstate == TCP_ESTABLISHED) {
        __u16 sport = ctx->sport;
        __u16 dport = bpf_ntohs(ctx->dport);

        if (is_target_port(sport) || is_target_port(dport)) {
            __u8 *seen = bpf_map_lookup_elem(&seen_connections, &cookie);
            if (!seen) {
                __u8 val = 1;
                bpf_map_update_elem(&seen_connections, &cookie, &val, BPF_ANY);
                send_event(ctx, EVENT_TYPE_CONNECT, sk);
            }
        }
    }

    if (newstate == TCP_CLOSE || newstate == TCP_CLOSE_WAIT) {
        bpf_map_delete_elem(&seen_connections, &cookie);
        bpf_map_delete_elem(&sock_proc_map, &cookie);
    }

    return 0;
}

SEC("kprobe/tcp_recvmsg")
int BPF_KPROBE(tcp_recvmsg, struct sock *sk) {
    __u16 family = BPF_CORE_READ(sk, __sk_common.skc_family);
    if (family != 2)
        return 0;

    __u16 sport = BPF_CORE_READ(sk, __sk_common.skc_num);
    __u16 dport = BPF_CORE_READ(sk, __sk_common.skc_dport);
    dport = bpf_ntohs(dport);

    if (is_target_port(sport) || is_target_port(dport)) {
        send_event(ctx, EVENT_TYPE_RECV, sk);
    }

    return 0;
}
