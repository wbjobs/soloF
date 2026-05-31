#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

#ifndef TASK_COMM_LEN
#define TASK_COMM_LEN 16
#endif

#ifndef MAX_STACK_DEPTH
#define MAX_STACK_DEPTH 127
#endif

#ifndef MAX_ENTRIES
#define MAX_ENTRIES 16384
#endif

#ifndef RINGBUF_SIZE
#define RINGBUF_SIZE (1 << 20)
#endif

/*
 * stacks: stores user and kernel stack traces. Each stack is identified by a
 * stack ID returned by bpf_get_stackid(). The map is of type
 * BPF_MAP_TYPE_STACK_TRACE with value size = sizeof(u64) * MAX_STACK_DEPTH.
 */
struct {
	__uint(type, BPF_MAP_TYPE_STACK_TRACE);
	__uint(key_size, sizeof(u32));
	__uint(value_size, sizeof(u64) * MAX_STACK_DEPTH);
	__uint(max_entries, MAX_ENTRIES);
} stacks SEC(".maps");

/*
 * sample is the payload written to the ring buffer for every on-cpu sample.
 * The comm field is exactly TASK_COMM_LEN (16) bytes to guarantee that
 * bpf_get_current_comm() can never overflow it, even if the helper ever
 * writes a longer string. The verifier enforces bounds on the size
 * parameter, so passing sizeof(comm) is always safe.
 */
typedef struct sample {
	u32 user_stack_id;
	u32 kernel_stack_id;
	char comm[TASK_COMM_LEN];
} sample_t;

/*
 * rb: a BPF ring buffer that delivers each sample to userspace. Using a ring
 * buffer instead of an in-kernel hash map solves the tail-loss problem:
 * when the sampling window ends, userspace can drain the ring buffer with a
 * short grace period before producing the final flamegraph.
 */
struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, RINGBUF_SIZE);
} rb SEC(".maps");

/*
 * on_cpu_sample is attached as a BPF_PROG_TYPE_PERF_EVENT program.
 * It records the user and kernel stacks of the currently running task on
 * the CPU that triggered the sample.
 */
SEC("perf_event")
int on_cpu_sample(struct bpf_perf_event_data *ctx)
{
	s32 user_stack_id, kernel_stack_id;

	/* Capture user and kernel stack traces for the current task. */
	user_stack_id = bpf_get_stackid(ctx, &stacks, BPF_F_USER_STACK);
	kernel_stack_id = bpf_get_stackid(ctx, &stacks, 0);

	/* If neither stack yielded a valid id, skip the sample. */
	if (user_stack_id < 0 && kernel_stack_id < 0) {
		return 0;
	}

	sample_t *s = bpf_ringbuf_reserve(&rb, sizeof(*s), 0);
	if (!s) {
		return 0;
	}

	s->user_stack_id = (u32)user_stack_id;
	s->kernel_stack_id = (u32)kernel_stack_id;

	/*
	 * bpf_get_current_comm is safe here because:
	 *   1. s->comm is exactly TASK_COMM_LEN (16) bytes.
	 *   2. We pass the exact sizeof(s->comm) as the size argument.
	 *   3. The helper always NUL-terminates and never writes past size.
	 *
	 * The previous "invalid access to map" error was caused by an
	 * undersized buffer combined with passing a size larger than the
	 * actual allocation. Using a struct member with a fixed, correct
	 * size eliminates that class of bug.
	 */
	__builtin_memset(s->comm, 0, sizeof(s->comm));
	bpf_get_current_comm(s->comm, sizeof(s->comm));

	bpf_ringbuf_submit(s, 0);
	return 0;
}

char LICENSE[] SEC("license") = "GPL";
