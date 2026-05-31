// Package profiler samples a given process via eBPF and produces flamegraph
// folded output.
//
// The sampler opens a perf_event with the software CPU clock scoped to the
// target PID and attaches the pre-compiled on_cpu BPF program to it. Each
// sample is delivered to userspace through a BPF ring buffer. When the
// sampling window closes, the ring buffer is drained with a short grace
// period so that no tail samples are lost. Stack IDs are resolved into
// symbol names using /proc/PID/maps and the process' ELF.
package profiler

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"

	"github.com/ebpf-profiler/profiler/internal/bpf"
)

// drainGracePeriod is the extra time to keep reading the ring buffer after
// the sampling window has ended. In-flight samples can arrive up to a few
// milliseconds after the perf event is disabled; this window captures them.
const drainGracePeriod = 100 * time.Millisecond

// Options controls how a profiling run is executed.
type Options struct {
	// PID is the target process. Must be > 0.
	PID int
	// Duration is the sampling window.
	Duration time.Duration
	// SampleHz is the perf_event sample frequency. Defaults to 99.
	SampleHz int
	// ObjectPath is the path to the compiled eBPF ELF object. If empty the
	// default path / environment variable is used.
	ObjectPath string
}

// Result holds the raw folded output produced by a profiling run.
type Result struct {
	// Folded is flamegraph-compatible text, one stack per line:
	// frame1;frame2;... count
	Folded string
	// TotalSamples is the number of samples that were recorded.
	TotalSamples uint64
	// DroppedSamples is the number of samples dropped because the ring
	// buffer was full. Non-zero means the sampling frequency or buffer
	// size should be tuned.
	DroppedSamples uint64
}

// Profile performs a single sampling run and returns the folded output.
func Profile(ctx context.Context, opts Options) (*Result, error) {
	if err := validateOptions(opts); err != nil {
		return nil, err
	}
	if opts.SampleHz <= 0 {
		opts.SampleHz = 99
	}
	if opts.ObjectPath == "" {
		opts.ObjectPath = bpf.DefaultObjectPath()
	}

	if err := checkPIDReachable(opts.PID); err != nil {
		return nil, err
	}

	obj, err := bpf.LoadObjectFrom(opts.ObjectPath)
	if err != nil {
		return nil, fmt.Errorf("load eBPF object: %w (hint: run `make bpf`) ", err)
	}
	defer obj.Close()

	profileLink, err := attachPerfEvent(opts.PID, opts.SampleHz, obj.Programs.OnCpuSample)
	if err != nil {
		return nil, fmt.Errorf("attach perf_event: %w", err)
	}

	// Aggregation state populated by the ring buffer reader goroutine.
	var (
		mu        sync.Mutex
		samples   = make(map[sampleKey]uint64)
		total     uint64
		dropped   uint64
		readerErr error
	)

	reader, err := ringbuf.NewReader(obj.Maps.Rb)
	if err != nil {
		_ = profileLink.Close()
		return nil, fmt.Errorf("create ringbuf reader: %w", err)
	}
	defer reader.Close()

	// The reader goroutine pulls samples out of the ring buffer until
	// either the context is cancelled or the reader is closed after the
	// grace period.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			rec, err := reader.Read()
			if err != nil {
				if errors.Is(err, ringbuf.ErrClosed) {
					return
				}
				if errors.Is(err, ringbuf.ErrFlushed) {
					continue
				}
				mu.Lock()
				readerErr = err
				mu.Unlock()
				return
			}
			key, ok := parseSample(rec.RawSample)
			if !ok {
				mu.Lock()
				dropped++
				mu.Unlock()
				continue
			}
			mu.Lock()
			samples[key]++
			total++
			mu.Unlock()
		}
	}()

	// Wait for the sampling window (or caller cancellation).
	select {
	case <-ctx.Done():
		// Disable the perf event first so no new samples are generated.
		_ = profileLink.Close()
		// Give the ring buffer a brief grace period to drain.
		time.Sleep(drainGracePeriod)
		_ = reader.Close()
		wg.Wait()
		return nil, ctx.Err()
	case <-time.After(opts.Duration):
	}

	// Disable the perf event. New samples will no longer be generated,
	// but the ring buffer may still hold in-flight events.
	_ = profileLink.Close()

	// Drain window: keep the ring buffer reader alive for a short period
	// so that any samples already queued can be delivered. Without this
	// step the last few samples (the "tail") would be lost.
	graceTimer := time.NewTimer(drainGracePeriod)
	defer graceTimer.Stop()
	select {
	case <-graceTimer.C:
	case <-ctx.Done():
	}

	_ = reader.Close()
	wg.Wait()

	mu.Lock()
	err = readerErr
	snap := samples
	snapTotal := total
	snapDropped := dropped
	mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("ringbuf reader: %w", err)
	}

	return buildFoldedFromSamples(obj.Maps.Stacks, snap, snapTotal, snapDropped, opts.PID)
}

// sampleKey mirrors the BPF sample struct fields that we need to aggregate
// on. The comm field is used to prefix frames with the process name.
type sampleKey struct {
	UserStackID   uint32
	KernelStackID uint32
	Comm          string
}

// parseSample decodes a raw ring buffer sample into a sampleKey.
// The expected layout is:
//
//	u32 user_stack_id    (offset 0, 4 bytes)
//	u32 kernel_stack_id  (offset 4, 4 bytes)
//	char comm[16]        (offset 8, 16 bytes)
func parseSample(raw []byte) (sampleKey, bool) {
	if len(raw) < 24 {
		return sampleKey{}, false
	}
	var key sampleKey
	key.UserStackID = binary.LittleEndian.Uint32(raw[0:4])
	key.KernelStackID = binary.LittleEndian.Uint32(raw[4:8])
	// comm is NUL-terminated; trim to the first NUL byte.
	comm := raw[8:24]
	if nul := bytesIndexNUL(comm); nul >= 0 {
		comm = comm[:nul]
	}
	key.Comm = string(comm)
	return key, true
}

// bytesIndexNUL returns the index of the first zero byte in b, or -1.
func bytesIndexNUL(b []byte) int {
	for i, v := range b {
		if v == 0 {
			return i
		}
	}
	return -1
}

// validateOptions rejects obviously invalid inputs.
func validateOptions(o Options) error {
	switch {
	case o.PID <= 0:
		return ErrInvalidPID
	case o.Duration <= 0:
		return ErrInvalidDuration
	}
	return nil
}

// Sentinel errors returned by Profile and exposed via the HTTP API.
var (
	ErrInvalidPID      = errors.New("pid must be a positive integer")
	ErrInvalidDuration = errors.New("duration must be positive")
	ErrPIDNotFound     = errors.New("target pid does not exist")
	ErrPermission      = errors.New("insufficient privileges to profile target (need root or CAP_PERFMON / CAP_BPF)")
)

// checkPIDReachable returns nil if the target exists and we can reach its
// /proc/PID directory.
func checkPIDReachable(pid int) error {
	info, err := os.Stat(filepath.Join("/proc", strconv.Itoa(pid)))
	if err != nil {
		if os.IsNotExist(err) {
			return ErrPIDNotFound
		}
		if isPermissionErr(err) {
			return ErrPermission
		}
		return fmt.Errorf("stat /proc/%d: %w", pid, err)
	}
	if !info.IsDir() {
		return ErrPIDNotFound
	}
	f, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		if isPermissionErr(err) {
			return ErrPermission
		}
		return fmt.Errorf("open /proc/%d/status: %w", pid, err)
	}
	_ = f.Close()
	return nil
}

func isPermissionErr(err error) bool {
	return errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM)
}

const (
	perfTypeSoftware      = 1
	perfCountSWCpuClock   = 3
	perfFlagFreq          = 1 << 1
	perfSampleFormatIP    = 1 << 0
	perfSampleFormatTid   = 1 << 1
	perfSampleFormatTime  = 1 << 2
	perfSampleFormatStack = 1 << 10
)

type perfEventAttr struct {
	Type   uint32
	Size   uint32
	Config uint64

	SampleType   uint64
	SamplePeriod uint64
	ReadFormat   uint64

	Flags uint64

	WakeupEvents    uint32
	BpType          uint32
	Config1         uint64
	Config2         uint64
	BranchSample    uint64
	SampleRegsUser  uint64
	SampleStackUser uint32
	ClockID         int32
	SampleRegsIntr  uint64
	AuxWatermark    uint32
	SampleMaxStack  uint16
	__reserved_2    uint16
}

func attachPerfEvent(pid, sampleHz int, prog *ebpf.Program) (link.Link, error) {
	fd, err := openPerfEvent(pid, sampleHz)
	if err != nil {
		return nil, err
	}
	l, err := link.AttachRawLink(link.RawLinkOptions{
		Target:  fd,
		Program: prog,
		Attach:  ebpf.AttachPerfEvent,
	})
	if err != nil {
		_ = syscall.Close(fd)
		return nil, fmt.Errorf("link attach: %w", err)
	}
	// Enable the perf event now that the program is attached.
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), 0x2400 /*ENABLE*/, 0); errno != 0 {
		_ = l.Close()
		return nil, fmt.Errorf("ioctl ENABLE: %w", errno)
	}
	return l, nil
}

// openPerfEvent creates a software CPU-clock perf_event scoped to the given
// PID. The CPU field is -1 (any CPU) so the sampler follows the process
// across scheduling.
func openPerfEvent(pid, sampleHz int) (int, error) {
	attr := perfEventAttr{
		Type:         perfTypeSoftware,
		Config:       perfCountSWCpuClock,
		SamplePeriod: uint64(sampleHz),
		SampleType:   perfSampleFormatIP | perfSampleFormatTid | perfSampleFormatTime | perfSampleFormatStack,
		Flags:        perfFlagFreq,
		Size:         uint32(unsafe.Sizeof(perfEventAttr{})),
	}

	fd, _, errno := syscall.Syscall6(
		syscall.SYS_PERF_EVENT_OPEN,
		uintptr(unsafe.Pointer(&attr)),
		uintptr(pid),
		^uintptr(0),
		^uintptr(0),
		0,
		0,
	)
	if errno != 0 {
		switch errno {
		case syscall.ESRCH, syscall.ENODEV:
			return 0, ErrPIDNotFound
		case syscall.EACCES, syscall.EPERM:
			return 0, ErrPermission
		default:
			return 0, fmt.Errorf("perf_event_open: %w", errno)
		}
	}
	return int(fd), nil
}

// buildFoldedFromSamples reads the stacks map and the aggregated samples
// map, resolves each stack ID into symbol names, and produces the flamegraph
// folded output.
func buildFoldedFromSamples(stacksMap *ebpf.Map, samples map[sampleKey]uint64, total, dropped uint64, pid int) (*Result, error) {
	resolver, err := newSymbolResolver(pid)
	if err != nil {
		return nil, fmt.Errorf("symbol resolver: %w", err)
	}
	defer resolver.Close()

	type entry struct {
		key   sampleKey
		count uint64
	}
	var entries []entry
	for k, v := range samples {
		entries = append(entries, entry{key: k, count: v})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].count > entries[j].count })

	var builder strings.Builder
	for _, e := range entries {
		userFrames, err := resolveStack(stacksMap, e.key.UserStackID, resolver, true)
		if err != nil {
			return nil, fmt.Errorf("resolve user stack %d: %w", e.key.UserStackID, err)
		}
		kernelFrames, err := resolveStack(stacksMap, e.key.KernelStackID, resolver, false)
		if err != nil {
			return nil, fmt.Errorf("resolve kernel stack %d: %w", e.key.KernelStackID, err)
		}

		frames := make([]string, 0, len(kernelFrames)+len(userFrames)+1)
		// Prefix with the process name (comm) if available.
		if e.key.Comm != "" {
			frames = append(frames, e.key.Comm)
		}
		frames = append(frames, kernelFrames...)
		frames = append(frames, userFrames...)
		if len(frames) == 0 {
			frames = []string{"unknown"}
		}

		builder.WriteString(strings.Join(frames, ";"))
		builder.WriteByte(' ')
		builder.WriteString(strconv.FormatUint(e.count, 10))
		builder.WriteByte('\n')
	}

	return &Result{
		Folded:         builder.String(),
		TotalSamples:   total,
		DroppedSamples: dropped,
	}, nil
}

func resolveStack(m *ebpf.Map, id uint32, r *symbolResolver, user bool) ([]string, error) {
	const errNotFound = ^uint32(0)
	if id == errNotFound {
		return nil, nil
	}
	const maxDepth = 127
	buf := make([]byte, maxDepth*8)
	if err := m.Lookup(unsafe.Pointer(&id), buf); err != nil {
		if errors.Is(err, ebpf.ErrKeyNotExist) {
			return []string{"unknown"}, nil
		}
		return nil, err
	}
	ips := make([]uint64, 0, maxDepth)
	for i := 0; i < maxDepth; i++ {
		ip := binary.LittleEndian.Uint64(buf[i*8:])
		if ip == 0 {
			break
		}
		ips = append(ips, ip)
	}
	if len(ips) == 0 {
		return nil, nil
	}

	frames := make([]string, 0, len(ips))
	for _, ip := range ips {
		frames = append(frames, r.resolve(ip, user))
	}
	return frames, nil
}

// symbolResolver resolves instruction pointers for a given PID into human
// readable symbol names using /proc/PID/maps and ELF files. It performs
// best-effort resolution; unknown addresses are formatted as hex.
type symbolResolver struct {
	pid      int
	maps     []procMap
	elfCache map[string]*elfSymbols
	kallsyms kallsymTable
}

type procMap struct {
	Start, End uint64
	Perms      string
	Offset     uint64
	Path       string
}

type elfSymbols struct {
	path    string
	symbols []elfSym
}

type elfSym struct {
	name  string
	value uint64
	size  uint64
}

type kallsymTable struct {
	symbols []kallsym
}

type kallsym struct {
	addr  uint64
	name  string
	stype byte
}

func newSymbolResolver(pid int) (*symbolResolver, error) {
	r := &symbolResolver{pid: pid, elfCache: map[string]*elfSymbols{}}
	maps, err := parseProcMaps(pid)
	if err != nil {
		return nil, err
	}
	r.maps = maps
	if k, err := loadKallsyms(); err == nil {
		r.kallsyms = k
	}
	return r, nil
}

func (r *symbolResolver) Close() {}

func (r *symbolResolver) resolve(ip uint64, user bool) string {
	if ip == 0 {
		return "unknown"
	}
	if !user && ip >= 0xffff800000000000 {
		if name, ok := r.kallsyms.lookup(ip); ok {
			return name
		}
		return fmt.Sprintf("0x%x", ip)
	}
	for _, m := range r.maps {
		if ip >= m.Start && ip < m.End {
			fileOffset := (ip - m.Start) + m.Offset
			if m.Path != "" {
				if name, ok := r.lookupELF(m.Path, fileOffset); ok {
					return fmt.Sprintf("%s:%s", filepath.Base(m.Path), name)
				}
				return fmt.Sprintf("%s:0x%x", filepath.Base(m.Path), fileOffset)
			}
			return fmt.Sprintf("[anon:0x%x]", ip)
		}
	}
	return fmt.Sprintf("0x%x", ip)
}

func (r *symbolResolver) lookupELF(path string, fileOffset uint64) (string, bool) {
	syms, ok := r.elfCache[path]
	if !ok {
		s, err := parseELFSymbols(path)
		if err != nil {
			s = &elfSymbols{path: path}
		}
		r.elfCache[path] = s
		syms = s
	}
	if syms == nil || len(syms.symbols) == 0 {
		return "", false
	}
	idx := sort.Search(len(syms.symbols), func(i int) bool {
		return syms.symbols[i].value > fileOffset
	}) - 1
	if idx >= 0 {
		s := syms.symbols[idx]
		if fileOffset >= s.value && fileOffset < s.value+s.size {
			return s.name, true
		}
	}
	return "", false
}

func parseProcMaps(pid int) ([]procMap, error) {
	f, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "maps"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	var out []procMap
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		parts := strings.SplitN(fields[0], "-", 2)
		if len(parts) != 2 {
			continue
		}
		start, err := strconv.ParseUint(parts[0], 16, 64)
		if err != nil {
			continue
		}
		end, err := strconv.ParseUint(parts[1], 16, 64)
		if err != nil {
			continue
		}
		off, _ := strconv.ParseUint(fields[2], 16, 64)
		path := ""
		if len(fields) >= 6 {
			path = fields[5]
		}
		out = append(out, procMap{Start: start, End: end, Perms: fields[1], Offset: off, Path: path})
	}
	return out, nil
}

func parseELFSymbols(path string) (*elfSymbols, error) {
	return parseGoELF(path)
}

func parseGoELF(path string) (*elfSymbols, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	syms, err := readELFSymbols(f)
	if err != nil {
		return nil, err
	}
	sort.Slice(syms, func(i, j int) bool { return syms[i].value < syms[j].value })
	return &elfSymbols{path: path, symbols: syms}, nil
}

func loadKallsyms() (kallsymTable, error) {
	f, err := os.Open("/proc/kallsyms")
	if err != nil {
		return kallsymTable{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return kallsymTable{}, err
	}
	var out []kallsym
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		addr, err := strconv.ParseUint(fields[0], 16, 64)
		if err != nil {
			continue
		}
		out = append(out, kallsym{addr: addr, stype: fields[1][0], name: fields[2]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].addr < out[j].addr })
	return kallsymTable{symbols: out}, nil
}

func (t *kallsymTable) lookup(ip uint64) (string, bool) {
	idx := sort.Search(len(t.symbols), func(i int) bool { return t.symbols[i].addr > ip }) - 1
	if idx >= 0 {
		return t.symbols[idx].name, true
	}
	return "", false
}
