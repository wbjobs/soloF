.PHONY: all build generate clean help deps check-env

BINARY_NAME := syscall-monitor
BPF_DIR := ./bpf
PKG_EBPF_DIR := ./pkg/ebpf

UNAME_M := $(shell uname -m)
ifeq ($(UNAME_M),x86_64)
	ARCH := x86
else ifeq ($(UNAME_M),aarch64)
	ARCH := arm64
else
	ARCH := $(UNAME_M)
endif

KERNEL_VERSION := $(shell uname -r | cut -d. -f1,2)

all: build

check-env:
	@command -v clang >/dev/null 2>&1 || { echo "Error: clang is not installed. Please install clang first."; exit 1; }
	@command -v go >/dev/null 2>&1 || { echo "Error: go is not installed. Please install Go first."; exit 1; }
	@echo "Detected architecture: $(ARCH)"
	@echo "Detected kernel version: $(KERNEL_VERSION)"

build: check-env generate
	go build -o $(BINARY_NAME) ./cmd/syscall-monitor
	@echo "Build complete. Run with: sudo ./$(BINARY_NAME)"

generate: check-env
	cd $(PKG_EBPF_DIR) && go generate

build-legacy: check-env
	@echo "Building with legacy kernel support (for pre-5.4 kernels)..."
	cd $(PKG_EBPF_DIR) && CGO_ENABLED=0 go generate
	go build -tags legacy -o $(BINARY_NAME) ./cmd/syscall-monitor

clean:
	rm -f $(BINARY_NAME)
	rm -f $(PKG_EBPF_DIR)/bpf_bpf*.go
	rm -f $(PKG_EBPF_DIR)/bpf_bpf*.o
	@echo "Clean complete."

deps:
	go mod download
	@echo "Dependencies downloaded."

help:
	@echo "Available targets:"
	@echo "  all          - Build the project (default)"
	@echo "  build        - Build the Go binary with eBPF CO-RE support"
	@echo "  build-legacy - Build with enhanced legacy kernel support"
	@echo "  generate     - Generate eBPF bindings using bpf2go"
	@echo "  clean        - Remove built binaries and generated files"
	@echo "  deps         - Download Go dependencies"
	@echo "  check-env    - Check build environment"
	@echo "  help         - Show this help message"
	@echo ""
	@echo "Kernel compatibility notes:"
	@echo "  - Linux 4.15+: Basic tracepoint support"
	@echo "  - Linux 5.0+:  Enhanced BPF features"
	@echo "  - Linux 5.4+:  Full CO-RE support with BTF"
	@echo ""
	@echo "For kernels < 5.4, you may need to install kernel headers:"
	@echo "  Ubuntu/Debian: sudo apt-get install linux-headers-$$(uname -r)"
	@echo "  CentOS/RHEL:  sudo yum install kernel-devel-$$(uname -r)"
