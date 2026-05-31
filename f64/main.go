package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
	"golang.org/x/sys/unix"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -Werror" bpf bpf/syscalls.bpf.c

type Event struct {
	Pid       uint32
	Tid       uint32
	SyscallNr uint64
	Comm      [16]byte
	Args      [6]uint64
	Ret       int64
	IsExit    uint8
	Pad       [7]byte
}

var showEntry = flag.Bool("e", false, "Show syscall entry events")
var targetPid = flag.Int("p", 0, "Target PID to monitor")
var targetComm = flag.String("c", "", "Target process name (comm) to monitor")
var followForks = flag.Bool("f", false, "Follow forks and threads")
var showTid = flag.Bool("t", true, "Show thread ID (TID) in output")
var colorOutput = flag.Bool("color", true, "Enable color output for different threads")
var showTimestamp = flag.Bool("T", true, "Show timestamp in output")
var groupByThread = flag.Bool("g", false, "Group output by thread (buffered)")
var outputFormat = flag.String("o", "text", "Output format: text or json")

type JSONSyscallEvent struct {
	Timestamp string              `json:"timestamp"`
	Pid       uint32              `json:"pid"`
	Tid       uint32              `json:"tid"`
	Comm      string              `json:"comm"`
	Syscall   string              `json:"syscall"`
	SyscallNr uint64              `json:"syscall_nr"`
	IsExit    bool                `json:"is_exit"`
	Args      []JSONSyscallArg    `json:"args,omitempty"`
	Ret       int64               `json:"ret,omitempty"`
	RetStr    string              `json:"ret_str,omitempty"`
	Error     string              `json:"error,omitempty"`
}

type JSONSyscallArg struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var (
	colorIndex  int
	colorMutex  sync.Mutex
	tidColorMap = make(map[uint32]string)
)

var threadColors = []string{
	"\033[31m",
	"\033[32m",
	"\033[33m",
	"\033[34m",
	"\033[35m",
	"\033[36m",
	"\033[91m",
	"\033[92m",
	"\033[93m",
	"\033[94m",
	"\033[95m",
	"\033[96m",
	"\033[31;1m",
	"\033[32;1m",
	"\033[33;1m",
	"\033[34;1m",
}

const colorReset = "\033[0m"

type ThreadBuffer struct {
	mu     sync.Mutex
	events []string
}

var (
	threadBuffers = make(map[uint32]*ThreadBuffer)
	bufferMutex   sync.Mutex
)

func main() {
	flag.Parse()

	if *targetPid == 0 && *targetComm == "" {
		log.Fatal("Please specify a target PID with -p or process name with -c")
	}

	if err := rlimit.RemoveMemlock(); err != nil {
		log.Fatalf("Removing memlock rlimit: %v", err)
	}

	objs := bpfObjects{}
	if err := loadBpfObjects(&objs, nil); err != nil {
		log.Fatalf("Loading BPF objects: %v", err)
	}
	defer objs.Close()

	if *targetPid != 0 {
		pid := uint32(*targetPid)
		val := uint32(1)
		if err := objs.TargetPids.Put(&pid, &val); err != nil {
			log.Fatalf("Adding target PID: %v", err)
		}
		if *followForks {
			addChildPids(*targetPid, objs.TargetPids)
		}
		fmt.Printf("Monitoring PID %d\n", *targetPid)
	}

	if *targetComm != "" {
		fmt.Printf("Monitoring processes named '%s'\n", *targetComm)
	}

	rd, err := ringbuf.NewReader(objs.Events)
	if err != nil {
		log.Fatalf("Creating ringbuf reader: %v", err)
	}
	defer rd.Close()

	if *outputFormat != "text" && *outputFormat != "json" {
		log.Fatalf("Invalid output format: %s. Use 'text' or 'json'", *outputFormat)
	}

	if *outputFormat == "json" {
		*colorOutput = false
	}

	stopper := make(chan os.Signal, 1)
	signal.Notify(stopper, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-stopper
		if *outputFormat == "text" {
			fmt.Println("\nExiting...")
		}
		rd.Close()
		if *groupByThread && *outputFormat == "text" {
			flushThreadBuffers()
		}
	}()

	if *groupByThread && *outputFormat == "text" {
		fmt.Println("Grouping output by thread. Press Ctrl+C to see results.")
	}

	var event Event
	for {
		record, err := rd.Read()
		if err != nil {
			if err == ringbuf.ErrClosed {
				return
			}
			if *outputFormat == "text" {
				log.Printf("Reading from ringbuf: %v", err)
			}
			continue
		}

		if err := binary.Read(bytes.NewReader(record.RawSample), binary.LittleEndian, &event); err != nil {
			if *outputFormat == "text" {
				log.Printf("Parsing event: %v", err)
			}
			continue
		}

		if *targetComm != "" {
			comm := nullTerminatedString(event.Comm[:])
			if !strings.Contains(comm, *targetComm) {
				continue
			}
			pid := event.Pid
			val := uint32(1)
			objs.TargetPids.Put(&pid, &val)
		}

		if *followForks {
			pid := event.Pid
			val := uint32(1)
			objs.TargetPids.Put(&pid, &val)
		}

		if *outputFormat == "json" {
			printJSONEvent(&event)
		} else {
			if event.IsExit == 1 {
				printExitEvent(&event)
			} else if *showEntry {
				printEntryEvent(&event)
			}
		}
	}
}

func buildJSONEvent(event *Event) *JSONSyscallEvent {
	name := GetSyscallName(event.SyscallNr)
	comm := nullTerminatedString(event.Comm[:])

	jsonEvent := &JSONSyscallEvent{
		Timestamp: time.Now().Format(time.RFC3339Nano),
		Pid:       event.Pid,
		Tid:       event.Tid,
		Comm:      comm,
		Syscall:   name,
		SyscallNr: event.SyscallNr,
		IsExit:    event.IsExit == 1,
	}

	argDefs := getSyscallArgDefs(name)
	jsonArgs := make([]JSONSyscallArg, 0, len(argDefs))
	for i, arg := range event.Args {
		if i < len(argDefs) {
			jsonArgs = append(jsonArgs, JSONSyscallArg{
				Name:  argDefs[i].Name,
				Value: formatArg(argDefs[i].Type, arg),
			})
		} else if arg != 0 {
			jsonArgs = append(jsonArgs, JSONSyscallArg{
				Name:  fmt.Sprintf("arg%d", i),
				Value: fmt.Sprintf("0x%x", arg),
			})
		}
	}
	jsonEvent.Args = jsonArgs

	if event.IsExit == 1 {
		jsonEvent.Ret = event.Ret
		jsonEvent.RetStr = formatReturnValue(name, event.Ret)
		if event.Ret < 0 && event.Ret > -4096 {
			jsonEvent.Error = syscall.Errno(-event.Ret).Error()
		}
	}

	return jsonEvent
}

func printJSONEvent(event *Event) {
	if event.IsExit == 0 && !*showEntry {
		return
	}

	jsonEvent := buildJSONEvent(event)
	data, err := json.Marshal(jsonEvent)
	if err != nil {
		return
	}
	os.Stdout.Write(data)
	os.Stdout.Write([]byte("\n"))
}

func getTidColor(tid uint32) string {
	if !*colorOutput {
		return ""
	}
	colorMutex.Lock()
	defer colorMutex.Unlock()
	if color, ok := tidColorMap[tid]; ok {
		return color
	}
	color := threadColors[colorIndex%len(threadColors)]
	colorIndex++
	tidColorMap[tid] = color
	return color
}

func buildEventPrefix(event *Event) string {
	var parts []string

	if *showTimestamp {
		now := time.Now()
		parts = append(parts, fmt.Sprintf("%s.%06d",
			now.Format("15:04:05"),
			now.Nanosecond()/1000))
	}

	color := getTidColor(event.Tid)
	reset := ""
	if color != "" {
		reset = colorReset
	}

	if *showTid {
		if event.Tid == event.Pid {
			parts = append(parts, fmt.Sprintf("%sTID=%-6d%s", color, event.Tid, reset))
		} else {
			parts = append(parts, fmt.Sprintf("%sTID=%-6d%s", color, event.Tid, reset))
		}
	} else {
		parts = append(parts, fmt.Sprintf("%sPID=%-6d%s", color, event.Pid, reset))
	}

	return "[" + strings.Join(parts, " ") + "]"
}

func printEntryEvent(event *Event) {
	name := GetSyscallName(event.SyscallNr)
	comm := nullTerminatedString(event.Comm[:])
	prefix := buildEventPrefix(event)
	color := getTidColor(event.Tid)
	reset := ""
	if color != "" {
		reset = colorReset
	}

	var buf strings.Builder
	buf.WriteString(fmt.Sprintf("%s %s%s%s(", prefix, color, name, reset))

	argDefs := getSyscallArgDefs(name)
	argParts := make([]string, 0, len(event.Args))
	for i, arg := range event.Args {
		if i < len(argDefs) {
			argParts = append(argParts, fmt.Sprintf("%s=%s", argDefs[i].Name, formatArg(argDefs[i].Type, arg)))
		} else if arg != 0 {
			argParts = append(argParts, fmt.Sprintf("arg%d=0x%x", i, arg))
		}
	}
	buf.WriteString(strings.Join(argParts, ", "))
	buf.WriteString(") →")

	if *groupByThread {
		bufferEvent(event.Tid, buf.String())
	} else {
		fmt.Println(buf.String())
	}
}

func printExitEvent(event *Event) {
	name := GetSyscallName(event.SyscallNr)
	comm := nullTerminatedString(event.Comm[:])
	prefix := buildEventPrefix(event)
	color := getTidColor(event.Tid)
	reset := ""
	if color != "" {
		reset = colorReset
	}
	ret := formatReturnValue(name, event.Ret)

	var buf strings.Builder
	buf.WriteString(fmt.Sprintf("%s %s%s%s(", prefix, color, name, reset))

	argDefs := getSyscallArgDefs(name)
	argParts := make([]string, 0, len(event.Args))
	for i, arg := range event.Args {
		if i < len(argDefs) {
			argParts = append(argParts, fmt.Sprintf("%s=%s", argDefs[i].Name, formatArg(argDefs[i].Type, arg)))
		} else if arg != 0 {
			argParts = append(argParts, fmt.Sprintf("arg%d=0x%x", i, arg))
		}
	}
	buf.WriteString(strings.Join(argParts, ", "))
	buf.WriteString(fmt.Sprintf(") = %s", ret))

	if *groupByThread {
		bufferEvent(event.Tid, buf.String())
	} else {
		fmt.Println(buf.String())
	}
}

func bufferEvent(tid uint32, line string) {
	bufferMutex.Lock()
	buf, ok := threadBuffers[tid]
	if !ok {
		buf = &ThreadBuffer{}
		threadBuffers[tid] = buf
	}
	bufferMutex.Unlock()

	buf.mu.Lock()
	buf.events = append(buf.events, line)
	buf.mu.Unlock()
}

func flushThreadBuffers() {
	bufferMutex.Lock()
	defer bufferMutex.Unlock()

	for tid, buf := range threadBuffers {
		buf.mu.Lock()
		if len(buf.events) > 0 {
			color := getTidColor(tid)
			reset := ""
			if color != "" {
				reset = colorReset
			}
			fmt.Printf("\n%s=== Thread %d ===%s\n", color, tid, reset)
			for _, line := range buf.events {
				fmt.Println(line)
			}
			buf.events = nil
		}
		buf.mu.Unlock()
	}
}

func formatArgs(nr uint64, args []uint64) string {
	name := GetSyscallName(nr)
	formatted := make([]string, 0, len(args))
	argDefs := getSyscallArgDefs(name)
	for i, arg := range args {
		if i < len(argDefs) {
			formatted = append(formatted, formatArg(argDefs[i].Type, arg))
		} else {
			formatted = append(formatted, fmt.Sprintf("0x%x", arg))
		}
	}
	return strings.Join(formatted, ", ")
}

type ArgDef struct {
	Name string
	Type string
}

func getSyscallArgDefs(name string) []ArgDef {
	switch name {
	case "openat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"flags", "open_flags"},
			{"mode", "mode"},
		}
	case "open":
		return []ArgDef{
			{"pathname", "string"},
			{"flags", "open_flags"},
			{"mode", "mode"},
		}
	case "read":
		return []ArgDef{
			{"fd", "fd"},
			{"buf", "ptr"},
			{"count", "size"},
		}
	case "write":
		return []ArgDef{
			{"fd", "fd"},
			{"buf", "ptr"},
			{"count", "size"},
		}
	case "close":
		return []ArgDef{
			{"fd", "fd"},
		}
	case "readlinkat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"buf", "ptr"},
			{"bufsiz", "size"},
		}
	case "readlink":
		return []ArgDef{
			{"pathname", "string"},
			{"buf", "ptr"},
			{"bufsiz", "size"},
		}
	case "newfstatat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"statbuf", "ptr"},
			{"flags", "int"},
		}
	case "fstat":
		return []ArgDef{
			{"fd", "fd"},
			{"statbuf", "ptr"},
		}
	case "stat":
		return []ArgDef{
			{"pathname", "string"},
			{"statbuf", "ptr"},
		}
	case "lstat":
		return []ArgDef{
			{"pathname", "string"},
			{"statbuf", "ptr"},
		}
	case "poll":
		return []ArgDef{
			{"fds", "ptr"},
			{"nfds", "uint"},
			{"timeout", "int"},
		}
	case "lseek":
		return []ArgDef{
			{"fd", "fd"},
			{"offset", "off"},
			{"whence", "whence"},
		}
	case "mmap":
		return []ArgDef{
			{"addr", "ptr"},
			{"length", "size"},
			{"prot", "prot"},
			{"flags", "mmap_flags"},
			{"fd", "fd"},
			{"offset", "off"},
		}
	case "mprotect":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
			{"prot", "prot"},
		}
	case "munmap":
		return []ArgDef{
			{"addr", "ptr"},
			{"length", "size"},
		}
	case "brk":
		return []ArgDef{
			{"addr", "ptr"},
		}
	case "ioctl":
		return []ArgDef{
			{"fd", "fd"},
			{"cmd", "ulong"},
			{"arg", "ulong"},
		}
	case "pread64":
		return []ArgDef{
			{"fd", "fd"},
			{"buf", "ptr"},
			{"count", "size"},
			{"pos", "off"},
		}
	case "pwrite64":
		return []ArgDef{
			{"fd", "fd"},
			{"buf", "ptr"},
			{"count", "size"},
			{"pos", "off"},
		}
	case "readv":
		return []ArgDef{
			{"fd", "fd"},
			{"iov", "ptr"},
			{"iovcnt", "int"},
		}
	case "writev":
		return []ArgDef{
			{"fd", "fd"},
			{"iov", "ptr"},
			{"iovcnt", "int"},
		}
	case "access":
		return []ArgDef{
			{"pathname", "string"},
			{"mode", "mode"},
		}
	case "pipe":
		return []ArgDef{
			{"pipefd", "ptr"},
		}
	case "select":
		return []ArgDef{
			{"nfds", "int"},
			{"readfds", "ptr"},
			{"writefds", "ptr"},
			{"exceptfds", "ptr"},
			{"timeout", "ptr"},
		}
	case "sched_yield":
		return []ArgDef{}
	case "mremap":
		return []ArgDef{
			{"old_address", "ptr"},
			{"old_size", "size"},
			{"new_size", "size"},
			{"flags", "mremap_flags"},
			{"new_address", "ptr"},
		}
	case "msync":
		return []ArgDef{
			{"addr", "ptr"},
			{"length", "size"},
			{"flags", "msync_flags"},
		}
	case "mincore":
		return []ArgDef{
			{"addr", "ptr"},
			{"length", "size"},
			{"vec", "ptr"},
		}
	case "madvise":
		return []ArgDef{
			{"addr", "ptr"},
			{"length", "size"},
			{"advice", "advice"},
		}
	case "socket":
		return []ArgDef{
			{"domain", "int"},
			{"type", "sock_type"},
			{"protocol", "int"},
		}
	case "connect":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "socklen"},
		}
	case "accept":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "ptr"},
		}
	case "accept4":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "ptr"},
			{"flags", "sock_flags"},
		}
	case "sendto":
		return []ArgDef{
			{"sockfd", "fd"},
			{"buf", "ptr"},
			{"len", "size"},
			{"flags", "msg_flags"},
			{"dest_addr", "ptr"},
			{"addrlen", "socklen"},
		}
	case "recvfrom":
		return []ArgDef{
			{"sockfd", "fd"},
			{"buf", "ptr"},
			{"len", "size"},
			{"flags", "msg_flags"},
			{"src_addr", "ptr"},
			{"addrlen", "ptr"},
		}
	case "sendmsg":
		return []ArgDef{
			{"sockfd", "fd"},
			{"msg", "ptr"},
			{"flags", "msg_flags"},
		}
	case "recvmsg":
		return []ArgDef{
			{"sockfd", "fd"},
			{"msg", "ptr"},
			{"flags", "msg_flags"},
		}
	case "shutdown":
		return []ArgDef{
			{"sockfd", "fd"},
			{"how", "int"},
		}
	case "bind":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "socklen"},
		}
	case "listen":
		return []ArgDef{
			{"sockfd", "fd"},
			{"backlog", "int"},
		}
	case "getsockname":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "ptr"},
		}
	case "getpeername":
		return []ArgDef{
			{"sockfd", "fd"},
			{"addr", "ptr"},
			{"addrlen", "ptr"},
		}
	case "socketpair":
		return []ArgDef{
			{"domain", "int"},
			{"type", "sock_type"},
			{"protocol", "int"},
			{"sv", "ptr"},
		}
	case "setsockopt":
		return []ArgDef{
			{"sockfd", "fd"},
			{"level", "int"},
			{"optname", "int"},
			{"optval", "ptr"},
			{"optlen", "socklen"},
		}
	case "getsockopt":
		return []ArgDef{
			{"sockfd", "fd"},
			{"level", "int"},
			{"optname", "int"},
			{"optval", "ptr"},
			{"optlen", "ptr"},
		}
	case "clone":
		return []ArgDef{
			{"flags", "clone_flags"},
			{"child_stack", "ptr"},
			{"parent_tid", "ptr"},
			{"child_tid", "ptr"},
			{"tls", "ptr"},
		}
	case "fork":
		return []ArgDef{}
	case "vfork":
		return []ArgDef{}
	case "execve":
		return []ArgDef{
			{"pathname", "string"},
			{"argv", "ptr"},
			{"envp", "ptr"},
		}
	case "execveat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"argv", "ptr"},
			{"envp", "ptr"},
			{"flags", "int"},
		}
	case "exit":
		return []ArgDef{
			{"status", "int"},
		}
	case "exit_group":
		return []ArgDef{
			{"status", "int"},
		}
	case "wait4":
		return []ArgDef{
			{"pid", "pid"},
			{"wstatus", "ptr"},
			{"options", "wait_flags"},
			{"ru", "ptr"},
		}
	case "kill":
		return []ArgDef{
			{"pid", "pid"},
			{"sig", "signal"},
		}
	case "tkill":
		return []ArgDef{
			{"tid", "pid"},
			{"sig", "signal"},
		}
	case "tgkill":
		return []ArgDef{
			{"tgid", "pid"},
			{"tid", "pid"},
			{"sig", "signal"},
		}
	case "uname":
		return []ArgDef{
			{"buf", "ptr"},
		}
	case "fcntl":
		return []ArgDef{
			{"fd", "fd"},
			{"cmd", "fcntl_cmd"},
			{"arg", "ulong"},
		}
	case "flock":
		return []ArgDef{
			{"fd", "fd"},
			{"operation", "flock_op"},
		}
	case "fsync":
		return []ArgDef{
			{"fd", "fd"},
		}
	case "fdatasync":
		return []ArgDef{
			{"fd", "fd"},
		}
	case "truncate":
		return []ArgDef{
			{"pathname", "string"},
			{"length", "off"},
		}
	case "ftruncate":
		return []ArgDef{
			{"fd", "fd"},
			{"length", "off"},
		}
	case "getdents":
		return []ArgDef{
			{"fd", "fd"},
			{"dirp", "ptr"},
			{"count", "uint"},
		}
	case "getdents64":
		return []ArgDef{
			{"fd", "fd"},
			{"dirp", "ptr"},
			{"count", "uint"},
		}
	case "getcwd":
		return []ArgDef{
			{"buf", "ptr"},
			{"size", "size"},
		}
	case "chdir":
		return []ArgDef{
			{"path", "string"},
		}
	case "fchdir":
		return []ArgDef{
			{"fd", "fd"},
		}
	case "rename":
		return []ArgDef{
			{"oldpath", "string"},
			{"newpath", "string"},
		}
	case "renameat":
		return []ArgDef{
			{"olddirfd", "fd"},
			{"oldpath", "string"},
			{"newdirfd", "fd"},
			{"newpath", "string"},
		}
	case "renameat2":
		return []ArgDef{
			{"olddirfd", "fd"},
			{"oldpath", "string"},
			{"newdirfd", "fd"},
			{"newpath", "string"},
			{"flags", "rename_flags"},
		}
	case "mkdir":
		return []ArgDef{
			{"pathname", "string"},
			{"mode", "mode"},
		}
	case "mkdirat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"mode", "mode"},
		}
	case "rmdir":
		return []ArgDef{
			{"pathname", "string"},
		}
	case "creat":
		return []ArgDef{
			{"pathname", "string"},
			{"mode", "mode"},
		}
	case "link":
		return []ArgDef{
			{"oldpath", "string"},
			{"newpath", "string"},
		}
	case "linkat":
		return []ArgDef{
			{"olddirfd", "fd"},
			{"oldpath", "string"},
			{"newdirfd", "fd"},
			{"newpath", "string"},
			{"flags", "int"},
		}
	case "unlink":
		return []ArgDef{
			{"pathname", "string"},
		}
	case "unlinkat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"flags", "int"},
		}
	case "symlink":
		return []ArgDef{
			{"target", "string"},
			{"linkpath", "string"},
		}
	case "symlinkat":
		return []ArgDef{
			{"target", "string"},
			{"newdirfd", "fd"},
			{"linkpath", "string"},
		}
	case "readlink":
		return []ArgDef{
			{"pathname", "string"},
			{"buf", "ptr"},
			{"bufsiz", "size"},
		}
	case "chmod":
		return []ArgDef{
			{"pathname", "string"},
			{"mode", "mode"},
		}
	case "fchmod":
		return []ArgDef{
			{"fd", "fd"},
			{"mode", "mode"},
		}
	case "fchmodat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"mode", "mode"},
			{"flags", "int"},
		}
	case "chown":
		return []ArgDef{
			{"pathname", "string"},
			{"owner", "uid"},
			{"group", "gid"},
		}
	case "fchown":
		return []ArgDef{
			{"fd", "fd"},
			{"owner", "uid"},
			{"group", "gid"},
		}
	case "lchown":
		return []ArgDef{
			{"pathname", "string"},
			{"owner", "uid"},
			{"group", "gid"},
		}
	case "fchownat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"owner", "uid"},
			{"group", "gid"},
			{"flags", "int"},
		}
	case "umask":
		return []ArgDef{
			{"mask", "mode"},
		}
	case "gettimeofday":
		return []ArgDef{
			{"tv", "ptr"},
			{"tz", "ptr"},
		}
	case "getrlimit":
		return []ArgDef{
			{"resource", "resource"},
			{"rlim", "ptr"},
		}
	case "setrlimit":
		return []ArgDef{
			{"resource", "resource"},
			{"rlim", "ptr"},
		}
	case "getrusage":
		return []ArgDef{
			{"who", "who"},
			{"usage", "ptr"},
		}
	case "sysinfo":
		return []ArgDef{
			{"info", "ptr"},
		}
	case "times":
		return []ArgDef{
			{"buf", "ptr"},
		}
	case "ptrace":
		return []ArgDef{
			{"request", "ptrace_req"},
			{"pid", "pid"},
			{"addr", "ptr"},
			{"data", "ptr"},
		}
	case "getuid":
		return []ArgDef{}
	case "getgid":
		return []ArgDef{}
	case "setuid":
		return []ArgDef{
			{"uid", "uid"},
		}
	case "setgid":
		return []ArgDef{
			{"gid", "gid"},
		}
	case "geteuid":
		return []ArgDef{}
	case "getegid":
		return []ArgDef{}
	case "getpid":
		return []ArgDef{}
	case "getppid":
		return []ArgDef{}
	case "gettid":
		return []ArgDef{}
	case "time":
		return []ArgDef{
			{"tloc", "ptr"},
		}
	case "nanosleep":
		return []ArgDef{
			{"rqtp", "ptr"},
			{"rmtp", "ptr"},
		}
	case "clock_gettime":
		return []ArgDef{
			{"clk_id", "clockid"},
			{"tp", "ptr"},
		}
	case "clock_settime":
		return []ArgDef{
			{"clk_id", "clockid"},
			{"tp", "ptr"},
		}
	case "clock_getres":
		return []ArgDef{
			{"clk_id", "clockid"},
			{"res", "ptr"},
		}
	case "clock_nanosleep":
		return []ArgDef{
			{"clk_id", "clockid"},
			{"flags", "int"},
			{"request", "ptr"},
			{"remain", "ptr"},
		}
	case "alarm":
		return []ArgDef{
			{"seconds", "uint"},
		}
	case "setitimer":
		return []ArgDef{
			{"which", "itimer"},
			{"new_value", "ptr"},
			{"old_value", "ptr"},
		}
	case "getitimer":
		return []ArgDef{
			{"which", "itimer"},
			{"curr_value", "ptr"},
		}
	case "pause":
		return []ArgDef{}
	case "dup":
		return []ArgDef{
			{"oldfd", "fd"},
		}
	case "dup2":
		return []ArgDef{
			{"oldfd", "fd"},
			{"newfd", "fd"},
		}
	case "dup3":
		return []ArgDef{
			{"oldfd", "fd"},
			{"newfd", "fd"},
			{"flags", "dup_flags"},
		}
	case "pipe2":
		return []ArgDef{
			{"pipefd", "ptr"},
			{"flags", "pipe_flags"},
		}
	case "sendfile":
		return []ArgDef{
			{"out_fd", "fd"},
			{"in_fd", "fd"},
			{"offset", "ptr"},
			{"count", "size"},
		}
	case "splice":
		return []ArgDef{
			{"fd_in", "fd"},
			{"off_in", "ptr"},
			{"fd_out", "fd"},
			{"off_out", "ptr"},
			{"len", "size"},
			{"flags", "splice_flags"},
		}
	case "tee":
		return []ArgDef{
			{"fd_in", "fd"},
			{"fd_out", "fd"},
			{"len", "size"},
			{"flags", "splice_flags"},
		}
	case "sync_file_range":
		return []ArgDef{
			{"fd", "fd"},
			{"offset", "off"},
			{"nbytes", "off"},
			{"flags", "sync_flags"},
		}
	case "vmsplice":
		return []ArgDef{
			{"fd", "fd"},
			{"iov", "ptr"},
			{"nr_segs", "ulong"},
			{"flags", "splice_flags"},
		}
	case "epoll_create":
		return []ArgDef{
			{"size", "int"},
		}
	case "epoll_create1":
		return []ArgDef{
			{"flags", "epoll_flags"},
		}
	case "epoll_ctl":
		return []ArgDef{
			{"epfd", "fd"},
			{"op", "epoll_op"},
			{"fd", "fd"},
			{"event", "ptr"},
		}
	case "epoll_wait":
		return []ArgDef{
			{"epfd", "fd"},
			{"events", "ptr"},
			{"maxevents", "int"},
			{"timeout", "int"},
		}
	case "epoll_pwait":
		return []ArgDef{
			{"epfd", "fd"},
			{"events", "ptr"},
			{"maxevents", "int"},
			{"timeout", "int"},
			{"sigmask", "ptr"},
		}
	case "inotify_init":
		return []ArgDef{}
	case "inotify_init1":
		return []ArgDef{
			{"flags", "inotify_flags"},
		}
	case "inotify_add_watch":
		return []ArgDef{
			{"fd", "fd"},
			{"pathname", "string"},
			{"mask", "uint"},
		}
	case "inotify_rm_watch":
		return []ArgDef{
			{"fd", "fd"},
			{"wd", "int"},
		}
	case "signalfd":
		return []ArgDef{
			{"fd", "fd"},
			{"mask", "ptr"},
			{"flags", "int"},
		}
	case "signalfd4":
		return []ArgDef{
			{"fd", "fd"},
			{"mask", "ptr"},
			{"flags", "int"},
		}
	case "eventfd":
		return []ArgDef{
			{"initval", "uint"},
		}
	case "eventfd2":
		return []ArgDef{
			{"initval", "uint"},
			{"flags", "int"},
		}
	case "timerfd_create":
		return []ArgDef{
			{"clockid", "clockid"},
			{"flags", "timerfd_flags"},
		}
	case "timerfd_settime":
		return []ArgDef{
			{"fd", "fd"},
			{"flags", "int"},
			{"new_value", "ptr"},
			{"old_value", "ptr"},
		}
	case "timerfd_gettime":
		return []ArgDef{
			{"fd", "fd"},
			{"curr_value", "ptr"},
		}
	case "fallocate":
		return []ArgDef{
			{"fd", "fd"},
			{"mode", "int"},
			{"offset", "off"},
			{"len", "off"},
		}
	case "faccessat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"mode", "mode"},
			{"flags", "int"},
		}
	case "pselect6":
		return []ArgDef{
			{"nfds", "int"},
			{"readfds", "ptr"},
			{"writefds", "ptr"},
			{"exceptfds", "ptr"},
			{"timeout", "ptr"},
			{"sigmask", "ptr"},
		}
	case "ppoll":
		return []ArgDef{
			{"fds", "ptr"},
			{"nfds", "nfds_t"},
			{"timeout", "ptr"},
			{"sigmask", "ptr"},
		}
	case "unshare":
		return []ArgDef{
			{"flags", "unshare_flags"},
		}
	case "setns":
		return []ArgDef{
			{"fd", "fd"},
			{"nstype", "int"},
		}
	case "getcpu":
		return []ArgDef{
			{"cpu", "ptr"},
			{"node", "ptr"},
			{"cache", "ptr"},
		}
	case "sched_setaffinity":
		return []ArgDef{
			{"pid", "pid"},
			{"cpusetsize", "size"},
			{"mask", "ptr"},
		}
	case "sched_getaffinity":
		return []ArgDef{
			{"pid", "pid"},
			{"cpusetsize", "size"},
			{"mask", "ptr"},
		}
	case "sched_setattr":
		return []ArgDef{
			{"pid", "pid"},
			{"attr", "ptr"},
			{"flags", "uint"},
		}
	case "sched_getattr":
		return []ArgDef{
			{"pid", "pid"},
			{"attr", "ptr"},
			{"size", "uint"},
			{"flags", "uint"},
		}
	case "sched_setscheduler":
		return []ArgDef{
			{"pid", "pid"},
			{"policy", "int"},
			{"param", "ptr"},
		}
	case "sched_getscheduler":
		return []ArgDef{
			{"pid", "pid"},
		}
	case "sched_getparam":
		return []ArgDef{
			{"pid", "pid"},
			{"param", "ptr"},
		}
	case "sched_setparam":
		return []ArgDef{
			{"pid", "pid"},
			{"param", "ptr"},
		}
	case "sched_get_priority_max":
		return []ArgDef{
			{"policy", "int"},
		}
	case "sched_get_priority_min":
		return []ArgDef{
			{"policy", "int"},
		}
	case "sched_rr_get_interval":
		return []ArgDef{
			{"pid", "pid"},
			{"interval", "ptr"},
		}
	case "mlock":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
		}
	case "munlock":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
		}
	case "mlockall":
		return []ArgDef{
			{"flags", "int"},
		}
	case "munlockall":
		return []ArgDef{}
	case "mlock2":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
			{"flags", "int"},
		}
	case "mknod":
		return []ArgDef{
			{"pathname", "string"},
			{"mode", "mode"},
			{"dev", "dev"},
		}
	case "mknodat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"mode", "mode"},
			{"dev", "dev"},
		}
	case "personality":
		return []ArgDef{
			{"personality", "uint"},
		}
	case "ustat":
		return []ArgDef{
			{"dev", "dev"},
			{"ubuf", "ptr"},
		}
	case "statfs":
		return []ArgDef{
			{"path", "string"},
			{"buf", "ptr"},
		}
	case "fstatfs":
		return []ArgDef{
			{"fd", "fd"},
			{"buf", "ptr"},
		}
	case "sysfs":
		return []ArgDef{
			{"option", "int"},
			{"buf", "ptr"},
		}
	case "getpriority":
		return []ArgDef{
			{"which", "int"},
			{"who", "id_t"},
		}
	case "setpriority":
		return []ArgDef{
			{"which", "int"},
			{"who", "id_t"},
			{"niceval", "int"},
		}
	case "prctl":
		return []ArgDef{
			{"option", "int"},
			{"arg2", "ulong"},
			{"arg3", "ulong"},
			{"arg4", "ulong"},
			{"arg5", "ulong"},
		}
	case "arch_prctl":
		return []ArgDef{
			{"code", "int"},
			{"addr", "ptr"},
		}
	case "adjtimex":
		return []ArgDef{
			{"buf", "ptr"},
		}
	case "chroot":
		return []ArgDef{
			{"path", "string"},
		}
	case "sync":
		return []ArgDef{}
	case "acct":
		return []ArgDef{
			{"filename", "string"},
		}
	case "settimeofday":
		return []ArgDef{
			{"tv", "ptr"},
			{"tz", "ptr"},
		}
	case "mount":
		return []ArgDef{
			{"source", "string"},
			{"target", "string"},
			{"filesystemtype", "string"},
			{"mountflags", "ulong"},
			{"data", "ptr"},
		}
	case "umount2":
		return []ArgDef{
			{"target", "string"},
			{"flags", "int"},
		}
	case "swapon":
		return []ArgDef{
			{"path", "string"},
			{"swap_flags", "int"},
		}
	case "swapoff":
		return []ArgDef{
			{"path", "string"},
		}
	case "reboot":
		return []ArgDef{
			{"magic1", "int"},
			{"magic2", "int"},
			{"cmd", "int"},
			{"arg", "ptr"},
		}
	case "sethostname":
		return []ArgDef{
			{"name", "string"},
			{"len", "size"},
		}
	case "setdomainname":
		return []ArgDef{
			{"name", "string"},
			{"len", "size"},
		}
	case "iopl":
		return []ArgDef{
			{"level", "int"},
		}
	case "ioperm":
		return []ArgDef{
			{"from", "ulong"},
			{"num", "ulong"},
			{"turn_on", "int"},
		}
	case "init_module":
		return []ArgDef{
			{"module_image", "ptr"},
			{"len", "size"},
			{"param_values", "string"},
		}
	case "finit_module":
		return []ArgDef{
			{"fd", "fd"},
			{"param_values", "string"},
			{"flags", "int"},
		}
	case "delete_module":
		return []ArgDef{
			{"name", "string"},
			{"flags", "int"},
		}
	case "get_kernel_syms":
		return []ArgDef{
			{"table", "ptr"},
		}
	case "query_module":
		return []ArgDef{
			{"name", "string"},
			{"which", "int"},
			{"buf", "ptr"},
			{"bufsize", "size"},
			{"ret", "ptr"},
		}
	case "quotactl":
		return []ArgDef{
			{"cmd", "int"},
			{"special", "string"},
			{"id", "int"},
			{"addr", "ptr"},
		}
	case "nfsservctl":
		return []ArgDef{
			{"cmd", "int"},
			{"argp", "ptr"},
			{"resp", "ptr"},
		}
	case "setpgid":
		return []ArgDef{
			{"pid", "pid"},
			{"pgid", "pid"},
		}
	case "getpgid":
		return []ArgDef{
			{"pid", "pid"},
		}
	case "getpgrp":
		return []ArgDef{}
	case "setsid":
		return []ArgDef{}
	case "getsid":
		return []ArgDef{
			{"pid", "pid"},
		}
	case "setreuid":
		return []ArgDef{
			{"ruid", "uid"},
			{"euid", "uid"},
		}
	case "setregid":
		return []ArgDef{
			{"rgid", "gid"},
			{"egid", "gid"},
		}
	case "getgroups":
		return []ArgDef{
			{"size", "int"},
			{"list", "ptr"},
		}
	case "setgroups":
		return []ArgDef{
			{"size", "size"},
			{"list", "ptr"},
		}
	case "setresuid":
		return []ArgDef{
			{"ruid", "uid"},
			{"euid", "uid"},
			{"suid", "uid"},
		}
	case "getresuid":
		return []ArgDef{
			{"ruid", "ptr"},
			{"euid", "ptr"},
			{"suid", "ptr"},
		}
	case "setresgid":
		return []ArgDef{
			{"rgid", "gid"},
			{"egid", "gid"},
			{"sgid", "gid"},
		}
	case "getresgid":
		return []ArgDef{
			{"rgid", "ptr"},
			{"egid", "ptr"},
			{"sgid", "ptr"},
		}
	case "setfsuid":
		return []ArgDef{
			{"uid", "uid"},
		}
	case "setfsgid":
		return []ArgDef{
			{"gid", "gid"},
		}
	case "capget":
		return []ArgDef{
			{"hdrp", "ptr"},
			{"datap", "ptr"},
		}
	case "capset":
		return []ArgDef{
			{"hdrp", "ptr"},
			{"datap", "ptr"},
		}
	case "rt_sigaction":
		return []ArgDef{
			{"sig", "signal"},
			{"act", "ptr"},
			{"oldact", "ptr"},
			{"sigsetsize", "size"},
		}
	case "rt_sigprocmask":
		return []ArgDef{
			{"how", "int"},
			{"set", "ptr"},
			{"oldset", "ptr"},
			{"sigsetsize", "size"},
		}
	case "rt_sigreturn":
		return []ArgDef{
			{"info", "ptr"},
		}
	case "rt_sigpending":
		return []ArgDef{
			{"set", "ptr"},
			{"sigsetsize", "size"},
		}
	case "rt_sigtimedwait":
		return []ArgDef{
			{"set", "ptr"},
			{"info", "ptr"},
			{"timeout", "ptr"},
			{"sigsetsize", "size"},
		}
	case "rt_sigqueueinfo":
		return []ArgDef{
			{"pid", "pid"},
			{"sig", "signal"},
			{"info", "ptr"},
		}
	case "rt_sigsuspend":
		return []ArgDef{
			{"mask", "ptr"},
			{"sigsetsize", "size"},
		}
	case "sigaltstack":
		return []ArgDef{
			{"ss", "ptr"},
			{"old_ss", "ptr"},
		}
	case "utime":
		return []ArgDef{
			{"filename", "string"},
			{"times", "ptr"},
		}
	case "utimes":
		return []ArgDef{
			{"filename", "string"},
			{"times", "ptr"},
		}
	case "futimesat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"times", "ptr"},
		}
	case "utimensat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"times", "ptr"},
			{"flags", "int"},
		}
	case "futimens":
		return []ArgDef{
			{"fd", "fd"},
			{"times", "ptr"},
		}
	case "mknodat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"mode", "mode"},
			{"dev", "dev"},
		}
	case "setxattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
			{"flags", "int"},
		}
	case "lsetxattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
			{"flags", "int"},
		}
	case "fsetxattr":
		return []ArgDef{
			{"fd", "fd"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
			{"flags", "int"},
		}
	case "getxattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
		}
	case "lgetxattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
		}
	case "fgetxattr":
		return []ArgDef{
			{"fd", "fd"},
			{"name", "string"},
			{"value", "ptr"},
			{"size", "size"},
		}
	case "listxattr":
		return []ArgDef{
			{"path", "string"},
			{"list", "ptr"},
			{"size", "size"},
		}
	case "llistxattr":
		return []ArgDef{
			{"path", "string"},
			{"list", "ptr"},
			{"size", "size"},
		}
	case "flistxattr":
		return []ArgDef{
			{"fd", "fd"},
			{"list", "ptr"},
			{"size", "size"},
		}
	case "removexattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
		}
	case "lremovexattr":
		return []ArgDef{
			{"path", "string"},
			{"name", "string"},
		}
	case "fremovexattr":
		return []ArgDef{
			{"fd", "fd"},
			{"name", "string"},
		}
	case "futex":
		return []ArgDef{
			{"uaddr", "ptr"},
			{"futex_op", "int"},
			{"val", "int"},
			{"timeout", "ptr"},
			{"uaddr2", "ptr"},
			{"val3", "int"},
		}
	case "set_tid_address":
		return []ArgDef{
			{"tidptr", "ptr"},
		}
	case "restart_syscall":
		return []ArgDef{}
	case "semtimedop":
		return []ArgDef{
			{"semid", "int"},
			{"sops", "ptr"},
			{"nsops", "size"},
			{"timeout", "ptr"},
		}
	case "fadvise64":
		return []ArgDef{
			{"fd", "fd"},
			{"offset", "off"},
			{"len", "off"},
			{"advice", "int"},
		}
	case "timer_create":
		return []ArgDef{
			{"clockid", "clockid"},
			{"sevp", "ptr"},
			{"timerid", "ptr"},
		}
	case "timer_settime":
		return []ArgDef{
			{"timerid", "int"},
			{"flags", "int"},
			{"new_value", "ptr"},
			{"old_value", "ptr"},
		}
	case "timer_gettime":
		return []ArgDef{
			{"timerid", "int"},
			{"curr_value", "ptr"},
		}
	case "timer_delete":
		return []ArgDef{
			{"timerid", "int"},
		}
	case "timer_getoverrun":
		return []ArgDef{
			{"timerid", "int"},
		}
	case "clock_adjtime":
		return []ArgDef{
			{"clk_id", "clockid"},
			{"buf", "ptr"},
		}
	case "syncfs":
		return []ArgDef{
			{"fd", "fd"},
		}
	case "setns":
		return []ArgDef{
			{"fd", "fd"},
			{"nstype", "int"},
		}
	case "process_vm_readv":
		return []ArgDef{
			{"pid", "pid"},
			{"lvec", "ptr"},
			{"liovcnt", "ulong"},
			{"rvec", "ptr"},
			{"riovcnt", "ulong"},
			{"flags", "ulong"},
		}
	case "process_vm_writev":
		return []ArgDef{
			{"pid", "pid"},
			{"lvec", "ptr"},
			{"liovcnt", "ulong"},
			{"rvec", "ptr"},
			{"riovcnt", "ulong"},
			{"flags", "ulong"},
		}
	case "kcmp":
		return []ArgDef{
			{"pid1", "pid"},
			{"pid2", "pid"},
			{"type", "int"},
			{"idx1", "ulong"},
			{"idx2", "ulong"},
		}
	case "finit_module":
		return []ArgDef{
			{"fd", "fd"},
			{"param_values", "string"},
			{"flags", "int"},
		}
	case "sched_setattr":
		return []ArgDef{
			{"pid", "pid"},
			{"attr", "ptr"},
			{"flags", "uint"},
		}
	case "sched_getattr":
		return []ArgDef{
			{"pid", "pid"},
			{"attr", "ptr"},
			{"size", "uint"},
			{"flags", "uint"},
		}
	case "renameat2":
		return []ArgDef{
			{"olddirfd", "fd"},
			{"oldpath", "string"},
			{"newdirfd", "fd"},
			{"newpath", "string"},
			{"flags", "uint"},
		}
	case "seccomp":
		return []ArgDef{
			{"op", "uint"},
			{"flags", "uint"},
			{"args", "ptr"},
		}
	case "getrandom":
		return []ArgDef{
			{"buf", "ptr"},
			{"count", "size"},
			{"flags", "uint"},
		}
	case "memfd_create":
		return []ArgDef{
			{"name", "string"},
			{"flags", "uint"},
		}
	case "kexec_file_load":
		return []ArgDef{
			{"kernel_fd", "fd"},
			{"initrd_fd", "fd"},
			{"cmdline_len", "ulong"},
			{"cmdline", "string"},
			{"flags", "ulong"},
		}
	case "bpf":
		return []ArgDef{
			{"cmd", "int"},
			{"attr", "ptr"},
			{"size", "size"},
		}
	case "execveat":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"argv", "ptr"},
			{"envp", "ptr"},
			{"flags", "int"},
		}
	case "userfaultfd":
		return []ArgDef{
			{"flags", "int"},
		}
	case "membarrier":
		return []ArgDef{
			{"cmd", "int"},
			{"flags", "int"},
		}
	case "mlock2":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
			{"flags", "int"},
		}
	case "copy_file_range":
		return []ArgDef{
			{"fd_in", "fd"},
			{"off_in", "ptr"},
			{"fd_out", "fd"},
			{"off_out", "ptr"},
			{"len", "size"},
			{"flags", "uint"},
		}
	case "preadv2":
		return []ArgDef{
			{"fd", "fd"},
			{"iov", "ptr"},
			{"iovcnt", "int"},
			{"pos_l", "off"},
			{"pos_h", "off"},
			{"flags", "int"},
		}
	case "pwritev2":
		return []ArgDef{
			{"fd", "fd"},
			{"iov", "ptr"},
			{"iovcnt", "int"},
			{"pos_l", "off"},
			{"pos_h", "off"},
			{"flags", "int"},
		}
	case "pkey_mprotect":
		return []ArgDef{
			{"addr", "ptr"},
			{"len", "size"},
			{"prot", "int"},
			{"pkey", "int"},
		}
	case "pkey_alloc":
		return []ArgDef{
			{"flags", "uint"},
			{"access_rights", "uint"},
		}
	case "pkey_free":
		return []ArgDef{
			{"pkey", "int"},
		}
	case "statx":
		return []ArgDef{
			{"dirfd", "fd"},
			{"pathname", "string"},
			{"flags", "int"},
			{"mask", "uint"},
			{"statxbuf", "ptr"},
		}
	case "io_pgetevents":
		return []ArgDef{
			{"ctx_id", "ulong"},
			{"min_nr", "long"},
			{"nr", "long"},
			{"events", "ptr"},
			{"timeout", "ptr"},
			{"usigmask", "ptr"},
		}
	case "rseq":
		return []ArgDef{
			{"rseq", "ptr"},
			{"rseq_len", "uint"},
			{"flags", "int"},
			{"sig", "uint"},
		}
	default:
		return []ArgDef{
			{"arg0", "ulong"},
			{"arg1", "ulong"},
			{"arg2", "ulong"},
			{"arg3", "ulong"},
			{"arg4", "ulong"},
			{"arg5", "ulong"},
		}
	}
}

func printSyscallArgs(name string, args []uint64, isEntry bool) {
	argDefs := getSyscallArgDefs(name)
	parts := make([]string, 0, len(args))
	for i, arg := range args {
		if i < len(argDefs) {
			parts = append(parts, fmt.Sprintf("%s=%s", argDefs[i].Name, formatArg(argDefs[i].Type, arg)))
		} else if arg != 0 {
			parts = append(parts, fmt.Sprintf("arg%d=0x%x", i, arg))
		}
	}
	fmt.Print(strings.Join(parts, ", "))
}

func formatArg(argType string, val uint64) string {
	switch argType {
	case "string":
		if val == 0 {
			return "NULL"
		}
		return fmt.Sprintf("\"%s\"", readStringSafe(val))
	case "fd":
		return fmt.Sprintf("%d", int32(val))
	case "ptr":
		if val == 0 {
			return "NULL"
		}
		return fmt.Sprintf("0x%x", val)
	case "int":
		return fmt.Sprintf("%d", int64(val))
	case "uint":
		return fmt.Sprintf("%d", val)
	case "long":
		return fmt.Sprintf("%d", int64(val))
	case "ulong":
		return fmt.Sprintf("%d", val)
	case "size":
		return fmt.Sprintf("%d", val)
	case "off":
		return fmt.Sprintf("%d", int64(val))
	case "pid":
		return fmt.Sprintf("%d", int32(val))
	case "uid":
		return fmt.Sprintf("%d", int32(val))
	case "gid":
		return fmt.Sprintf("%d", int32(val))
	case "mode":
		return fmt.Sprintf("0%o", val)
	case "dev":
		return fmt.Sprintf("%d", val)
	case "id_t":
		return fmt.Sprintf("%d", int32(val))
	case "nfds_t":
		return fmt.Sprintf("%d", val)
	case "socklen":
		return fmt.Sprintf("%d", val)
	case "resource":
		return fmt.Sprintf("%d", int32(val))
	case "who":
		return fmt.Sprintf("%d", int32(val))
	case "signal":
		return fmt.Sprintf("%s (%d)", unix.SignalName(syscall.Signal(val)), int32(val))
	case "clockid":
		return fmt.Sprintf("%d", int32(val))
	case "itimer":
		return fmt.Sprintf("%d", int32(val))
	case "ptrace_req":
		return fmt.Sprintf("%d", int32(val))
	case "open_flags":
		return formatOpenFlags(int32(val))
	case "mmap_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "mremap_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "msync_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "advice":
		return fmt.Sprintf("%d", int32(val))
	case "prot":
		return fmt.Sprintf("0x%x", int32(val))
	case "sock_type":
		return fmt.Sprintf("%d", int32(val))
	case "sock_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "msg_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "clone_flags":
		return fmt.Sprintf("0x%x", val)
	case "wait_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "fcntl_cmd":
		return fmt.Sprintf("%d", int32(val))
	case "flock_op":
		return fmt.Sprintf("%d", int32(val))
	case "whence":
		return fmt.Sprintf("%d", int32(val))
	case "rename_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "dup_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "pipe_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "splice_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "sync_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "epoll_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "epoll_op":
		return fmt.Sprintf("%d", int32(val))
	case "inotify_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "timerfd_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "unshare_flags":
		return fmt.Sprintf("0x%x", int32(val))
	case "futex_op":
		return fmt.Sprintf("%d", int32(val))
	default:
		return fmt.Sprintf("0x%x", val)
	}
}

func formatReturnValue(name string, ret int64) string {
	switch name {
	case "open", "openat", "creat", "socket", "accept", "accept4", "dup", "dup2", "dup3",
		"pipe", "pipe2", "eventfd", "eventfd2", "timerfd_create", "signalfd", "signalfd4",
		"epoll_create", "epoll_create1", "inotify_init", "inotify_init1", "inotify_add_watch",
		"memfd_create", "userfaultfd", "pkey_alloc", "socketpair", "shmget", "msgget", "semget":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "close", "unlink", "unlinkat", "rmdir", "rename", "renameat", "renameat2",
		"chdir", "fchdir", "chroot", "sync", "fsync", "fdatasync", "syncfs",
		"mount", "umount2", "swapon", "swapoff", "reboot", "sethostname", "setdomainname",
		"kill", "tkill", "tgkill", "exit", "exit_group", "pause",
		"setuid", "setgid", "setreuid", "setregid", "setresuid", "setresgid",
		"setfsuid", "setfsgid", "setgroups", "setpgid", "setsid", "setns",
		"chmod", "fchmod", "fchmodat", "chown", "fchown", "lchown", "fchownat",
		"umask", "link", "linkat", "symlink", "symlinkat",
		"mkdir", "mkdirat", "mknod", "mknodat", "truncate", "ftruncate",
		"flock", "acct", "iopl", "ioperm", "personality",
		"init_module", "finit_module", "delete_module", "quotactl",
		"setxattr", "lsetxattr", "fsetxattr", "removexattr", "lremovexattr", "fremovexattr",
		"mlock", "munlock", "mlockall", "munlockall", "mlock2",
		"madvise", "munmap", "mprotect", "brk",
		"sched_setaffinity", "sched_setparam", "sched_setscheduler", "sched_setattr",
		"sched_yield", "unshare", "setpriority",
		"prctl", "arch_prctl", "adjtimex", "settimeofday", "clock_settime",
		"timer_settime", "timer_delete", "timerfd_settime", "clock_nanosleep",
		"sigaltstack", "seccomp", "pkey_free", "pkey_mprotect",
		"shmdt", "shmctl", "semctl", "msgctl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "read", "write", "readv", "writev", "pread64", "pwrite64", "preadv", "pwritev",
		"preadv2", "pwritev2", "recvfrom", "recvmsg", "sendto", "sendmsg",
		"sendmmsg", "recvmmsg", "sendfile", "splice", "tee", "vmsplice",
		"copy_file_range", "readlink", "readlinkat", "getrandom":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "lseek":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "mmap":
		if ret < 0 && ret > -4096 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("0x%x", uint64(ret))
	case "mremap":
		if ret < 0 && ret > -4096 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("0x%x", uint64(ret))
	case "getpid", "getppid", "gettid", "getuid", "geteuid", "getgid", "getegid",
		"getpgrp", "getsid", "getpgid":
		return fmt.Sprintf("%d", ret)
	case "poll", "select", "pselect6", "ppoll", "epoll_wait", "epoll_pwait":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "nanosleep", "clock_nanosleep":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "futex":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "stat", "fstat", "lstat", "newfstatat", "statx":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "access", "faccessat":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "connect", "bind", "listen", "shutdown",
		"getsockname", "getpeername", "setsockopt", "getsockopt":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "getrusage", "sysinfo", "times", "uname", "gettimeofday",
		"clock_gettime", "clock_getres", "timer_gettime", "timerfd_gettime":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "getrlimit", "getrusage", "wait4", "waitid":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "getdents", "getdents64":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "getcwd":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "brk":
		return fmt.Sprintf("0x%x", uint64(ret))
	case "arch_prctl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "prctl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "ioctl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "fcntl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "fadvise64", "fallocate", "sync_file_range":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "sched_getaffinity", "sched_getattr", "sched_getparam",
		"sched_getscheduler", "sched_get_priority_max", "sched_get_priority_min",
		"sched_rr_get_interval":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "getpriority":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "clock_adjtime", "adjtimex":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "ptrace":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "sigaltstack":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "capget", "capset":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "rt_sigaction", "rt_sigprocmask", "rt_sigpending",
		"rt_sigtimedwait", "rt_sigqueueinfo", "rt_sigsuspend":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "mq_open", "mq_notify":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "mq_unlink", "mq_timedsend", "mq_timedreceive", "mq_getsetattr":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "kexec_load", "kexec_file_load":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "add_key", "request_key", "keyctl":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "ioprio_set", "ioprio_get":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "migrate_pages", "move_pages", "mbind", "set_mempolicy", "get_mempolicy":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "perf_event_open":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "fanotify_init", "fanotify_mark":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "prlimit64":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "name_to_handle_at", "open_by_handle_at":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "process_vm_readv", "process_vm_writev":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "kcmp":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "bpf":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "execve", "execveat":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "userfaultfd":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "membarrier":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "statx":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "io_pgetevents":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	case "rseq":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return "0"
	case "fork", "vfork", "clone":
		if ret < 0 {
			return fmt.Sprintf("-1 (%s)", syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	default:
		if ret < 0 && ret > -4096 {
			return fmt.Sprintf("%d (%s)", ret, syscall.Errno(-ret).Error())
		}
		return fmt.Sprintf("%d", ret)
	}
}

func formatOpenFlags(flags int32) string {
	flagNames := []struct {
		flag int32
		name string
	}{
		{00000001, "O_RDONLY"},
		{00000002, "O_WRONLY"},
		{00000004, "O_RDWR"},
		{00000100, "O_CREAT"},
		{00000200, "O_EXCL"},
		{00000400, "O_NOCTTY"},
		{00001000, "O_TRUNC"},
		{00002000, "O_APPEND"},
		{00004000, "O_NONBLOCK"},
		{00000040, "O_DSYNC"},
		{00040000, "O_LARGEFILE"},
		{00020000, "O_DIRECTORY"},
		{00010000, "O_NOFOLLOW"},
		{000002000000, "O_CLOEXEC"},
		{000004000000, "O_SYNC"},
		{000010000000, "O_PATH"},
		{000020000000, "O_TMPFILE"},
	}

	var names []string
	remaining := flags
	for _, fn := range flagNames {
		if remaining&fn.flag == fn.flag {
			names = append(names, fn.name)
			remaining &^= fn.flag
		}
	}
	if remaining != 0 {
		names = append(names, fmt.Sprintf("0x%x", remaining))
	}
	if len(names) == 0 {
		return "0"
	}
	return strings.Join(names, "|")
}

func nullTerminatedString(b []byte) string {
	n := bytes.IndexByte(b, 0)
	if n == -1 {
		return string(b)
	}
	return string(b[:n])
}

func readStringSafe(addr uint64) string {
	if addr == 0 {
		return ""
	}
	buf := make([]byte, 256)
	_, err := syscall.PtracePeekData(int(*targetPid), uintptr(addr), buf)
	if err != nil {
		return fmt.Sprintf("0x%x", addr)
	}
	n := bytes.IndexByte(buf, 0)
	if n == -1 {
		return fmt.Sprintf("%q...", buf[:64])
	}
	if n > 128 {
		return fmt.Sprintf("%q...", buf[:128])
	}
	return string(buf[:n])
}

func addChildPids(pid int, targetMap *ebpf.Map) {
	dir := fmt.Sprintf("/proc/%d/task", pid)
	tasks, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, task := range tasks {
		tid := 0
		fmt.Sscanf(task.Name(), "%d", &tid)
		if tid > 0 {
			key := uint32(tid)
			val := uint32(1)
			targetMap.Put(&key, &val)
		}
	}
}
