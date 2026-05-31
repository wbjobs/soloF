// Package bpf exposes access to the compiled eBPF ELF object used by the
// profiler.
//
// The project relies on `bpf2go` to compile on_cpu.bpf.c into an ELF object
// and generate a thin Go wrapper that embeds it. The generated source
// (on_cpu_bpf.go) is produced via:
//
//	go generate ./internal/bpf
//
// That step requires `clang`, `llvm-strip` and a Linux host (because the
// eBPF target only makes sense on Linux). The generated file is NOT
// committed in order to keep this source tree build-inspection friendly on
// any host; the Makefile at the repository root documents how to produce it.
//
// During development / on hosts without the BPF toolchain, callers can
// override the object path with LoadObjectFrom.
//
//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang on_cpu ./on_cpu.bpf.c -- -I/usr/include -O2 -g -Wall
package bpf

import (
	"fmt"
	"os"

	"github.com/cilium/ebpf"
)

// LoadObjectFrom loads the on_cpu ELF object from the given path.
// This is used both when bpf2go has embedded the object and when the user
// supplies an explicit path.
func LoadObjectFrom(path string) (*OnCPUObjects, error) {
	spec, err := ebpf.LoadCollectionSpec(path)
	if err != nil {
		return nil, fmt.Errorf("load eBPF collection spec %q: %w", path, err)
	}

	var obj OnCPUObjects
	if err := spec.LoadAndAssign(&obj, nil); err != nil {
		return nil, fmt.Errorf("load and assign eBPF objects: %w", err)
	}
	return &obj, nil
}

// DefaultObjectPath returns the default path used when no bpf2go output has
// been produced. The Makefile drops the compiled ELF here.
func DefaultObjectPath() string {
	if v := os.Getenv("PROFILER_BPF_OBJ"); v != "" {
		return v
	}
	return "internal/bpf/on_cpu_bpf.o"
}
