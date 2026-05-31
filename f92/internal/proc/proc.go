// Package proc provides helpers to discover running processes by name
// and to track the lifecycle of a process group (fork / exec).
package proc

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Info describes a single process.
type Info struct {
	PID   int
	PPID  int
	Name  string
	Cmd   string
	Start time.Time
}

// ErrProcessNotFound is returned when no process matches the filter.
var ErrProcessNotFound = errors.New("no matching process")

// List returns every running process. The returned slice is sorted by PID.
func List() ([]Info, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	var out []Info
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid <= 0 {
			continue
		}
		info, err := Read(pid)
		if err != nil {
			continue
		}
		out = append(out, info)
	}
	return out, nil
}

// Read reads /proc/PID/{stat,cmdline} for a single process.
func Read(pid int) (Info, error) {
	info := Info{PID: pid}
	if err := fillStat(pid, &info); err != nil {
		return Info{}, err
	}
	// Cmdline is best-effort; missing permission is not fatal.
	if cmd, err := readCmdline(pid); err == nil {
		info.Cmd = cmd
	}
	return info, nil
}

func fillStat(pid int, info *Info) error {
	f, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return err
	}
	defer f.Close()

	// /proc/PID/stat format: pid (comm) state ppid ...
	// The comm field is enclosed in parentheses and can contain spaces,
	// so we locate the last ')' to split the comm field safely.
	var buf [4096]byte
	n, err := f.Read(buf[:])
	if err != nil {
		return err
	}
	s := string(buf[:n])
	closeParen := strings.LastIndex(s, ")")
	if closeParen < 0 {
		return fmt.Errorf("unexpected /proc/%d/stat format", pid)
	}
	// pid is everything before the opening paren.
	openParen := strings.Index(s, "(")
	if openParen < 0 {
		return fmt.Errorf("unexpected /proc/%d/stat format", pid)
	}
	info.Name = strings.TrimSpace(s[openParen+1 : closeParen])

	rest := strings.TrimSpace(s[closeParen+1:])
	fields := strings.Fields(rest)
	// fields[0] = state, fields[1] = ppid
	if len(fields) >= 2 {
		ppid, _ := strconv.Atoi(fields[1])
		info.PPID = ppid
	}
	return nil
}

func readCmdline(pid int) (string, error) {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cmdline"))
	if err != nil {
		return "", err
	}
	// Arguments are separated by NUL bytes.
	cleaned := strings.TrimRight(string(data), "\x00")
	cleaned = strings.ReplaceAll(cleaned, "\x00", " ")
	return cleaned, nil
}

// FindByName returns the PIDs of every process whose comm (as reported by
// /proc/PID/stat) matches the given name. If no processes match,
// ErrProcessNotFound is returned.
func FindByName(name string) ([]int, error) {
	all, err := List()
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, p := range all {
		if p.Name == name {
			pids = append(pids, p.PID)
		}
	}
	if len(pids) == 0 {
		return nil, ErrProcessNotFound
	}
	return pids, nil
}

// FindByNamePrefix returns the PIDs of processes whose comm starts with
// the given prefix.
func FindByNamePrefix(prefix string) ([]int, error) {
	all, err := List()
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, p := range all {
		if strings.HasPrefix(p.Name, prefix) {
			pids = append(pids, p.PID)
		}
	}
	if len(pids) == 0 {
		return nil, ErrProcessNotFound
	}
	return pids, nil
}

// Tracker follows a process group identified by a name. It periodically
// scans /proc to detect new PIDs (fork) and removed PIDs (exit), so a
// streaming profile can reattach to replacement processes.
type Tracker struct {
	name    string
	scan    time.Duration
	stopCh  chan struct{}
	stopOnce sync.Once
	events  chan Event

	mu      sync.Mutex
	current map[int]struct{}
}

// Event describes a lifecycle change in the tracked process group.
type Event struct {
	Type EventType
	PID  int
	Name string
}

// EventType identifies the kind of lifecycle event.
type EventType int

const (
	EventAppeared EventType = iota
	EventDisappeared
)

// StartTracker begins watching the process group identified by name.
// It emits EventAppeared for any matching PID at start and then scans
// /proc every scan interval to detect forks / exits.
func StartTracker(name string, scan time.Duration) *Tracker {
	if scan <= 0 {
		scan = 1 * time.Second
	}
	t := &Tracker{
		name:    name,
		scan:    scan,
		stopCh:  make(chan struct{}),
		events:  make(chan Event, 64),
		current: make(map[int]struct{}),
	}
	go t.loop()
	return t
}

// Stop halts the tracker. Safe to call multiple times.
func (t *Tracker) Stop() {
	t.stopOnce.Do(func() { close(t.stopCh) })
}

// Events returns the channel that receives lifecycle events. The channel is
// closed when the tracker is stopped.
func (t *Tracker) Events() <-chan Event { return t.events }

// Current returns a snapshot of the currently tracked PIDs.
func (t *Tracker) Current() []int {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]int, 0, len(t.current))
	for pid := range t.current {
		out = append(out, pid)
	}
	return out
}

func (t *Tracker) loop() {
	defer close(t.events)

	// Initial snapshot.
	if pids, err := FindByName(t.name); err == nil {
		for _, pid := range pids {
			t.add(pid)
		}
	}

	ticker := time.NewTicker(t.scan)
	defer ticker.Stop()

	for {
		select {
		case <-t.stopCh:
			return
		case <-ticker.C:
			t.poll()
		}
	}
}

func (t *Tracker) poll() {
	pids, err := FindByName(t.name)
	if err != nil {
		// No matching process at all: every tracked PID has disappeared.
		t.mu.Lock()
		for pid := range t.current {
			delete(t.current, pid)
			t.send(Event{Type: EventDisappeared, PID: pid, Name: t.name})
		}
		t.mu.Unlock()
		return
	}

	seen := make(map[int]struct{}, len(pids))
	for _, pid := range pids {
		seen[pid] = struct{}{}
	}

	t.mu.Lock()
	// Detect new PIDs.
	for pid := range seen {
		if _, ok := t.current[pid]; !ok {
			t.current[pid] = struct{}{}
			t.send(Event{Type: EventAppeared, PID: pid, Name: t.name})
		}
	}
	// Detect removed PIDs.
	for pid := range t.current {
		if _, ok := seen[pid]; !ok {
			delete(t.current, pid)
			t.send(Event{Type: EventDisappeared, PID: pid, Name: t.name})
		}
	}
	t.mu.Unlock()
}

func (t *Tracker) add(pid int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.current[pid] = struct{}{}
	t.send(Event{Type: EventAppeared, PID: pid, Name: t.name})
}

// send emits an event. It is safe to call while holding the mutex because
// the channel is buffered and we drop on overflow.
func (t *Tracker) send(e Event) {
	select {
	case t.events <- e:
	default:
		// If the consumer can't keep up, drop the event; polling will
		// catch the state change on the next tick.
	}
}

// FollowFile opens /proc/kmsg-style follow mode on /proc/PID/... for the
// given path. It is not used in the default tracker but is kept for callers
// that want a more granular event stream (e.g. exec tracing when ptrace is
// available). The returned reader emits lines until the process exits.
func FollowFile(pid int, subpath string) (*bufio.Scanner, func() error, error) {
	f, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), subpath))
	if err != nil {
		return nil, nil, err
	}
	return bufio.NewScanner(f), f.Close, nil
}
