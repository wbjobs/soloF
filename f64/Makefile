BINARY := sysmon
BPF_SRC := bpf/syscalls.bpf.c
BPF_OBJ := bpf_bpfel.go bpf_bpfeb.go

.PHONY: all clean generate build

all: build

generate:
	go generate ./...

build: generate
	go build -o $(BINARY) .

clean:
	rm -f $(BINARY) $(BPF_OBJ)
