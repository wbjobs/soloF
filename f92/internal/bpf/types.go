package bpf

import "github.com/cilium/ebpf"

// OnCPUPrograms mirrors the programs produced by the eBPF ELF.
// It is kept structurally compatible with what `bpf2go` would generate
// so that the same assignment path works either way.
type OnCPUPrograms struct {
	OnCpuSample *ebpf.Program `ebpf:"on_cpu_sample"`
}

// Close detaches and unloads any loaded programs.
func (p *OnCPUPrograms) Close() error {
	if p == nil {
		return nil
	}
	if p.OnCpuSample != nil {
		_ = p.OnCpuSample.Close()
	}
	return nil
}

// OnCPUMaps mirrors the maps produced by the eBPF ELF.
// The counts hash map has been replaced by a ring buffer to prevent
// tail-call stack loss when the sampling window ends.
type OnCPUMaps struct {
	Stacks *ebpf.Map `ebpf:"stacks"`
	Rb     *ebpf.Map `ebpf:"rb"`
}

// Close releases the map file descriptors.
func (m *OnCPUMaps) Close() error {
	if m == nil {
		return nil
	}
	if m.Stacks != nil {
		_ = m.Stacks.Close()
	}
	if m.Rb != nil {
		_ = m.Rb.Close()
	}
	return nil
}

// OnCPUObjects is the combined handle returned by LoadObjectFrom.
type OnCPUObjects struct {
	Programs OnCPUPrograms
	Maps     OnCPUMaps
}

// Close releases all resources held by the loaded eBPF object.
func (o *OnCPUObjects) Close() error {
	_ = o.Programs.Close()
	_ = o.Maps.Close()
	return nil
}
