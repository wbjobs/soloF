.PHONY: all build-probe build-collector generate clean test

all: generate build-probe build-collector

generate:
	cd probe && go generate ./...

build-probe: generate
	cd probe && go build -o ../bin/probe .

build-collector:
	cd collector && go build -o ../bin/collector .

clean:
	rm -rf bin/ probe/bpf_*
	rm -f /tmp/tcp-probe.sock

deps:
	go mod download
	go install github.com/cilium/ebpf/cmd/bpf2go@latest

run-probe:
	sudo ./bin/probe

run-collector:
	./bin/collector

test-api:
	curl http://localhost:8090/api/traces | jq .
