package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang-14 bpf ../probe.c -- -I../headers -O2 -g

const (
	EventTypeConnect = 0
	EventTypeRecv    = 1
	ChannelSize      = 10000
	BatchSize        = 100
	TaskCommLen      = 16
)

type ProcInfo struct {
	PID  uint32 `json:"pid"`
	Comm string `json:"comm"`
}

type Event struct {
	Type        uint32  `json:"type"`
	PID         uint32  `json:"pid"`
	SAddr       uint32  `json:"saddr"`
	DAddr       uint32  `json:"daddr"`
	SPort       uint16  `json:"sport"`
	DPort       uint16  `json:"dport"`
	Timestamp   uint64  `json:"timestamp"`
	Cookie      uint64  `json:"cookie"`
	Comm        string  `json:"comm"`
	SrcProcess  ProcInfo `json:"src_process"`
	DstProcess  ProcInfo `json:"dst_process"`
	SrcIP       string  `json:"src_ip"`
	DstIP       string  `json:"dst_ip"`
	TimeStr     string  `json:"time_str"`
}

type rawProcInfo struct {
	PID  uint32
	Comm [TaskCommLen]byte
}

type rawEvent struct {
	Type        uint32
	PID         uint32
	SAddr       uint32
	DAddr       uint32
	SPort       uint16
	DPort       uint16
	Timestamp   uint64
	Cookie      uint64
	Comm        [TaskCommLen]byte
	SrcProcess  rawProcInfo
	DstProcess  rawProcInfo
}

var (
	eventCounter uint64
	dropCounter  uint64
)

func int2ip(n uint32) string {
	ip := make(net.IP, 4)
	binary.LittleEndian.PutUint32(ip, n)
	return ip.String()
}

func bytes2str(b [TaskCommLen]byte) string {
	n := bytes.IndexByte(b[:], 0)
	if n == -1 {
		n = TaskCommLen
	}
	return strings.TrimSpace(string(b[:n]))
}

func convertProcInfo(raw rawProcInfo) ProcInfo {
	return ProcInfo{
		PID:  raw.PID,
		Comm: bytes2str(raw.Comm),
	}
}

func main() {
	stopper := make(chan os.Signal, 1)
	signal.Notify(stopper, os.Interrupt, syscall.SIGTERM)

	if err := rlimit.RemoveMemlock(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to remove memlock: %v\n", err)
		os.Exit(1)
	}

	objs := bpfObjects{}
	if err := loadBpfObjects(&objs, nil); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load BPF objects: %v\n", err)
		os.Exit(1)
	}
	defer objs.Close()

	tpLink, err := link.Tracepoint("sock", "inet_sock_set_state", objs.TracepointInetSockSetState, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to attach tracepoint: %v\n", err)
		os.Exit(1)
	}
	defer tpLink.Close()

	kpConnect, err := link.Kprobe("tcp_v4_connect", objs.TcpV4Connect, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to attach tcp_v4_connect kprobe: %v\n", err)
		os.Exit(1)
	}
	defer kpConnect.Close()

	kpAccept, err := link.Kprobe("inet_csk_accept", objs.InetCskAccept, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to attach inet_csk_accept kprobe: %v\n", err)
		os.Exit(1)
	}
	defer kpAccept.Close()

	kpRecv, err := link.Kprobe("tcp_recvmsg", objs.TcpRecvmsg, nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to attach tcp_recvmsg kprobe: %v\n", err)
		os.Exit(1)
	}
	defer kpRecv.Close()

	rd, err := ringbuf.NewReader(objs.Events)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create ringbuf reader: %v\n", err)
		os.Exit(1)
	}
	defer rd.Close()

	eventChan := make(chan Event, ChannelSize)
	batchChan := make(chan []byte, ChannelSize/BatchSize)

	socketPath := "/tmp/tcp-probe.sock"
	os.Remove(socketPath)

	ln, err := net.Listen("unix", socketPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen on unix socket: %v\n", err)
		os.Exit(1)
	}
	defer ln.Close()
	os.Chmod(socketPath, 0666)

	fmt.Printf("Probe running. RingBuffer size: 16MB. Waiting for collector on %s...\n", socketPath)

	go eventProcessor(eventChan, batchChan)
	go connectionManager(ln, batchChan, stopper)
	go statsPrinter(stopper)

	go func() {
		for {
			record, err := rd.Read()
			if err != nil {
				if err == ringbuf.ErrClosed {
					return
				}
				atomic.AddUint64(&dropCounter, 1)
				continue
			}

			var raw rawEvent
			if err := binary.Read(bytes.NewBuffer(record.RawSample), binary.LittleEndian, &raw); err != nil {
				continue
			}

			event := Event{
				Type:       raw.Type,
				PID:        raw.PID,
				SAddr:      raw.SAddr,
				DAddr:      raw.DAddr,
				SPort:      raw.SPort,
				DPort:      raw.DPort,
				Timestamp:  raw.Timestamp,
				Cookie:     raw.Cookie,
				Comm:       bytes2str(raw.Comm),
				SrcProcess: convertProcInfo(raw.SrcProcess),
				DstProcess: convertProcInfo(raw.DstProcess),
				SrcIP:      int2ip(raw.SAddr),
				DstIP:      int2ip(raw.DAddr),
				TimeStr:    time.Now().Format(time.RFC3339Nano),
			}

			select {
			case eventChan <- event:
				atomic.AddUint64(&eventCounter, 1)
			default:
				atomic.AddUint64(&dropCounter, 1)
			}
		}
	}()

	<-stopper
	fmt.Println("\nShutting down...")
}

func eventProcessor(eventChan <-chan Event, batchChan chan<- []byte) {
	var batch []Event
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case event := <-eventChan:
			batch = append(batch, event)
			if len(batch) >= BatchSize {
				flushBatch(batch, batchChan)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				flushBatch(batch, batchChan)
				batch = batch[:0]
			}
		}
	}
}

func flushBatch(batch []Event, batchChan chan<- []byte) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	for _, event := range batch {
		if err := encoder.Encode(event); err != nil {
			continue
		}
	}
	if buf.Len() > 0 {
		select {
		case batchChan <- buf.Bytes():
		default:
		}
	}
}

func connectionManager(ln net.Listener, batchChan <-chan []byte, stopper <-chan os.Signal) {
	var (
		currentConn net.Conn
		connMu      sync.Mutex
	)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-stopper:
					return
				default:
					continue
				}
			}
			fmt.Println("Collector connected")

			connMu.Lock()
			if currentConn != nil {
				currentConn.Close()
			}
			currentConn = conn
			connMu.Unlock()
		}
	}()

	for batch := range batchChan {
		connMu.Lock()
		conn := currentConn
		connMu.Unlock()

		if conn != nil {
			conn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
			if _, err := conn.Write(batch); err != nil {
				connMu.Lock()
				if currentConn == conn {
					currentConn.Close()
					currentConn = nil
				}
				connMu.Unlock()
			}
		}
	}
}

func statsPrinter(stopper <-chan os.Signal) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	var lastCount uint64

	for {
		select {
		case <-ticker.C:
			current := atomic.LoadUint64(&eventCounter)
			dropped := atomic.LoadUint64(&dropCounter)
			rate := float64(current-lastCount) / 5.0
			fmt.Printf("Stats: Total=%d, Dropped=%d, Rate=%.1f evt/s\n", current, dropped, rate)
			lastCount = current
		case <-stopper:
			return
		}
	}
}
