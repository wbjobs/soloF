package ebpf

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/perf"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -Werror -Wno-unused-value -Wno-pointer-sign -Wno-compare-distinct-pointer-types -D__TARGET_ARCH_x86" bpf ../../bpf/syscall.bpf.c

type Monitor struct {
	objects   *bpfObjects
	enterLink link.Link
	exitLink  link.Link
	reader    *perf.Reader
}

func NewMonitor(pid int) (*Monitor, error) {
	objs := bpfObjects{}
	spec, err := loadBpf()
	if err != nil {
		return nil, fmt.Errorf("loading bpf spec: %v", err)
	}

	if pid > 0 {
		if err := spec.RewriteConstant("target_pid", int32(pid)); err != nil {
			return nil, fmt.Errorf("rewriting target_pid: %v", err)
		}
	}

	if err := spec.LoadAndAssign(&objs, nil); err != nil {
		return nil, fmt.Errorf("loading objects: %v", err)
	}

	enterLink, err := link.Tracepoint("syscalls", "sys_enter", objs.TracepointSysEnter, nil)
	if err != nil {
		objs.Close()
		return nil, fmt.Errorf("attaching sys_enter: %v", err)
	}

	exitLink, err := link.Tracepoint("syscalls", "sys_exit", objs.TracepointSysExit, nil)
	if err != nil {
		enterLink.Close()
		objs.Close()
		return nil, fmt.Errorf("attaching sys_exit: %v", err)
	}

	reader, err := perf.NewReader(objs.Events, os.Getpagesize())
	if err != nil {
		exitLink.Close()
		enterLink.Close()
		objs.Close()
		return nil, fmt.Errorf("creating perf reader: %v", err)
	}

	return &Monitor{
		objects:   &objs,
		enterLink: enterLink,
		exitLink:  exitLink,
		reader:    reader,
	}, nil
}

func (m *Monitor) Run(eventChan chan<- *Event, errChan chan<- error) {
	for {
		record, err := m.reader.Read()
		if err != nil {
			select {
			case errChan <- err:
			default:
			}
			return
		}

		if record.LostSamples != 0 {
			continue
		}

		var event Event
		if err := binary.Read(bytes.NewBuffer(record.RawSample), binary.LittleEndian, &event); err != nil {
			select {
			case errChan <- fmt.Errorf("parsing event: %v", err):
			default:
			}
			continue
		}

		eventChan <- &event
	}
}

func (m *Monitor) Close() {
	if m.reader != nil {
		m.reader.Close()
	}
	if m.enterLink != nil {
		m.enterLink.Close()
	}
	if m.exitLink != nil {
		m.exitLink.Close()
	}
	if m.objects != nil {
		m.objects.Close()
	}
}
