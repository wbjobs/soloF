package ebpf

import (
	"sort"
	"strings"
)

type Event struct {
	PID        uint32
	Comm       [16]byte
	SyscallNr  int32
	DurationNs uint64
}

func (e *Event) CommString() string {
	return strings.TrimRight(string(e.Comm[:]), "\x00")
}

type SyscallStats struct {
	SyscallName string
	Count       int
	TotalNs     uint64
	MinNs       uint64
	MaxNs       uint64
	AvgNs       uint64
}

type StatsCollector struct {
	syscalls map[string]*SyscallStats
}

func NewStatsCollector() *StatsCollector {
	return &StatsCollector{
		syscalls: make(map[string]*SyscallStats),
	}
}

func (sc *StatsCollector) AddEvent(event *Event, syscallName string) {
	name := syscallName
	if name == "" {
		name = "unknown"
	}

	stats, exists := sc.syscalls[name]
	if !exists {
		stats = &SyscallStats{
			SyscallName: name,
			MinNs:       ^uint64(0),
		}
		sc.syscalls[name] = stats
	}

	stats.Count++
	stats.TotalNs += event.DurationNs
	if event.DurationNs < stats.MinNs {
		stats.MinNs = event.DurationNs
	}
	if event.DurationNs > stats.MaxNs {
		stats.MaxNs = event.DurationNs
	}
	stats.AvgNs = stats.TotalNs / uint64(stats.Count)
}

func (sc *StatsCollector) GetTopByTotalTime(top int) []*SyscallStats {
	stats := make([]*SyscallStats, 0, len(sc.syscalls))
	for _, s := range sc.syscalls {
		stats = append(stats, s)
	}

	sort.Slice(stats, func(i, j int) bool {
		return stats[i].TotalNs > stats[j].TotalNs
	})

	if len(stats) > top {
		stats = stats[:top]
	}
	return stats
}

func (sc *StatsCollector) GetTotalCount() int {
	total := 0
	for _, s := range sc.syscalls {
		total += s.Count
	}
	return total
}
