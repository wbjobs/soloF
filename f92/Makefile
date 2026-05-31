# Makefile for eBPF CPU Profiler
#
# Targets:
#   bpf       - Compile the eBPF C program into an ELF object and
#               generate the bpf2go Go bindings. Requires clang,
#               llvm-strip, and a Linux host.
#   build     - Build the Go server binary (without re-running bpf2go).
#   run       - Build and run the server in the foreground.
#   clean     - Remove build artifacts.
#   generate  - Alias for `make bpf`.

BPF_SRC    := internal/bpf/on_cpu.bpf.c
BPF_OBJ    := internal/bpf/on_cpu_bpf.o
BPF_GEN    := internal/bpf/on_cpu_bpf.go
BPF_GEN_TMP := internal/bpf/on_cpu_bpf.go.tmp
GO_BIN     := ebpf-profiler

CFLAGS  := -O2 -g -Wall -Werror
BPF_CFLAGS := $(CFLAGS) -target bpf -I/usr/include

.PHONY: all bpf build run clean generate

all: bpf build

bpf:
	@echo "[bpf] Compiling $(BPF_SRC) -> $(BPF_OBJ)"
	clang $(BPF_CFLAGS) -c $(BPF_SRC) -o $(BPF_OBJ)
	llvm-strip -g $(BPF_OBJ) 2>/dev/null || true
	@echo "[bpf] Generating $(BPF_GEN) via bpf2go"
	@cd internal/bpf && go generate ./...

generate: bpf

build:
	@echo "[go]  Building $(GO_BIN)"
	go build -o $(GO_BIN) ./cmd/server

run: bpf build
	@echo "[go]  Running $(GO_BIN)"
	./$(GO_BIN)

clean:
	rm -f $(BPF_OBJ) $(BPF_GEN) $(GO_BIN)
	rm -rf downloads/
