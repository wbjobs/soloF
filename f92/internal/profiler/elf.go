package profiler

import (
	"debug/elf"
	"io"
)

// readELFSymbols is a tiny wrapper around debug/elf that keeps the main
// profiler source free from standard-library debug imports. It returns a
// best-effort list of global symbols from an ELF file.
func readELFSymbols(r io.ReaderAt) ([]elfSym, error) {
	f, err := elf.NewFile(r)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	syms, err := f.Symbols()
	if err != nil && len(syms) == 0 {
		// Fall back to dynamic symbol table (shared objects).
		syms, err = f.DynamicSymbols()
	}
	if err != nil {
		return nil, err
	}
	out := make([]elfSym, 0, len(syms))
	for _, s := range syms {
		if elf.ST_TYPE(s.Info) == elf.STT_NOTYPE {
			continue
		}
		if s.Size == 0 {
			s.Size = 1
		}
		out = append(out, elfSym{name: s.Name, value: s.Value, size: s.Size})
	}
	return out, nil
}
