CXX = emcc
CXXFLAGS = -O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","setValue","UTF8ToString"]'
EXPORTED_FUNCTIONS = -s EXPORTED_FUNCTIONS='["_malloc","_free","_lz4_compress_bound","_lz4_compress","_lz4_decompress","_lz4_set_dictionary","_lz4_compress_chunk","_lz4_decompress_chunk"]'

all: lz4_wasm.js

lz4_wasm.js: lz4_wasm.cpp
	$(CXX) $(CXXFLAGS) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME) -o $@ $<

clean:
	rm -f lz4_wasm.js lz4_wasm.wasm

.PHONY: all clean
