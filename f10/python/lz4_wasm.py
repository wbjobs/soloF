#!/usr/bin/env python3
"""
LZ4 WASM Python binding using wasmtime.
Provides fast compression/decompression with dictionary support.
"""

import os
import sys
import json
from typing import Optional, Union, List
from dataclasses import dataclass

try:
    from wasmtime import Engine, Store, Module, Instance, Func, Memory
except ImportError:
    print("wasmtime not installed. Install with: pip install wasmtime")
    sys.exit(1)


@dataclass
class CompressionResult:
    original_size: int
    compressed_size: int
    ratio: float
    data: bytes


@dataclass
class DecompressionResult:
    compressed_size: int
    decompressed_size: int
    data: bytes


class LZ4Wasm:
    def __init__(self, wasm_path: Optional[str] = None):
        if wasm_path is None:
            wasm_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "cpp",
                "lz4_wasm.wasm"
            )
        
        self.wasm_path = wasm_path
        self._init_wasm()
    
    def _init_wasm(self):
        self.engine = Engine()
        self.store = Store(self.engine)
        
        if os.path.exists(self.wasm_path):
            self.module = Module.from_file(self.engine, self.wasm_path)
            self.instance = Instance(self.store, self.module, [])
        else:
            raise FileNotFoundError(f"WASM module not found at {self.wasm_path}")
        
        self._lz4_compress_bound = self.instance.exports(self.store)["lz4_compress_bound"]
        self._lz4_compress = self.instance.exports(self.store)["lz4_compress"]
        self._lz4_decompress = self.instance.exports(self.store)["lz4_decompress"]
        self._lz4_set_dictionary = self.instance.exports(self.store)["lz4_set_dictionary"]
        self._lz4_compress_chunk = self.instance.exports(self.store)["lz4_compress_chunk"]
        self._lz4_decompress_chunk = self.instance.exports(self.store)["lz4_decompress_chunk"]
        self._memory = self.instance.exports(self.store)["memory"]
    
    def _alloc(self, size: int) -> int:
        if "malloc" in self.instance.exports(self.store):
            return self.instance.exports(self.store)["malloc"](self.store, size)
        raise NotImplementedError("malloc not exported from WASM")
    
    def _free(self, ptr: int):
        if "free" in self.instance.exports(self.store):
            self.instance.exports(self.store)["free"](self.store, ptr)
    
    def _read_memory(self, ptr: int, size: int) -> bytes:
        data_ptr = self._memory.data_ptr(self.store)
        return bytes(data_ptr[ptr:ptr + size])
    
    def _write_memory(self, ptr: int, data: bytes):
        data_ptr = self._memory.data_ptr(self.store)
        for i, b in enumerate(data):
            data_ptr[ptr + i] = b
    
    def compress(self, data: Union[bytes, str]) -> CompressionResult:
        if isinstance(data, str):
            data = data.encode('utf-8')
        
        src_size = len(data)
        dst_capacity = self._lz4_compress_bound(self.store, src_size)
        
        src_ptr = self._alloc(src_size)
        dst_ptr = self._alloc(dst_capacity)
        
        try:
            self._write_memory(src_ptr, data)
            compressed_size = self._lz4_compress(
                self.store, src_ptr, src_size, dst_ptr, dst_capacity
            )
            compressed_data = self._read_memory(dst_ptr, compressed_size)
        finally:
            self._free(src_ptr)
            self._free(dst_ptr)
        
        return CompressionResult(
            original_size=src_size,
            compressed_size=compressed_size,
            ratio=src_size / compressed_size if compressed_size > 0 else 0,
            data=compressed_data
        )
    
    def decompress(self, data: bytes, output_size: Optional[int] = None) -> DecompressionResult:
        src_size = len(data)
        dst_capacity = output_size or src_size * 3
        
        src_ptr = self._alloc(src_size)
        dst_ptr = self._alloc(dst_capacity)
        
        try:
            self._write_memory(src_ptr, data)
            decompressed_size = self._lz4_decompress(
                self.store, src_ptr, src_size, dst_ptr, dst_capacity
            )
            decompressed_data = self._read_memory(dst_ptr, decompressed_size)
        finally:
            self._free(src_ptr)
            self._free(dst_ptr)
        
        return DecompressionResult(
            compressed_size=src_size,
            decompressed_size=decompressed_size,
            data=decompressed_data
        )
    
    def set_dictionary(self, dict_data: bytes):
        dict_size = len(dict_data)
        dict_ptr = self._alloc(dict_size)
        
        try:
            self._write_memory(dict_ptr, dict_data)
            self._lz4_set_dictionary(self.store, dict_ptr, dict_size)
        finally:
            self._free(dict_ptr)
    
    def compress_chunk(self, data: Union[bytes, str]) -> bytes:
        result = self.compress(data)
        return result.data
    
    def decompress_chunk(self, data: bytes, output_size: Optional[int] = None) -> bytes:
        result = self.decompress(data, output_size)
        return result.data
    
    def compress_chunks(self, chunks: List[Union[bytes, str]]) -> List[bytes]:
        return [self.compress_chunk(chunk) for chunk in chunks]
    
    def decompress_chunks(self, chunks: List[bytes], output_sizes: Optional[List[int]] = None) -> List[bytes]:
        results = []
        for i, chunk in enumerate(chunks):
            output_size = output_sizes[i] if output_sizes else None
            results.append(self.decompress_chunk(chunk, output_size))
        return results


class LZ4Mock:
    """Mock implementation for testing when WASM is not available"""
    
    def compress(self, data: Union[bytes, str]) -> CompressionResult:
        if isinstance(data, str):
            data = data.encode('utf-8')
        
        import zlib
        compressed = zlib.compress(data, 1)
        
        return CompressionResult(
            original_size=len(data),
            compressed_size=len(compressed),
            ratio=len(data) / len(compressed),
            data=compressed
        )
    
    def decompress(self, data: bytes, output_size: Optional[int] = None) -> DecompressionResult:
        import zlib
        decompressed = zlib.decompress(data)
        
        return DecompressionResult(
            compressed_size=len(data),
            decompressed_size=len(decompressed),
            data=decompressed
        )
    
    def set_dictionary(self, dict_data: bytes):
        pass
    
    def compress_chunk(self, data: Union[bytes, str]) -> bytes:
        return self.compress(data).data
    
    def decompress_chunk(self, data: bytes, output_size: Optional[int] = None) -> bytes:
        return self.decompress(data, output_size).data


def get_lz4(use_mock: bool = False) -> Union[LZ4Wasm, LZ4Mock]:
    if use_mock:
        return LZ4Mock()
    
    try:
        return LZ4Wasm()
    except Exception as e:
        print(f"Warning: Failed to load WASM module, using mock: {e}")
        return LZ4Mock()


if __name__ == "__main__":
    lz4 = get_lz4(use_mock=True)
    
    test_data = b"Hello, World! This is a test string for LZ4 compression." * 100
    print(f"Original size: {len(test_data)} bytes")
    
    compressed = lz4.compress(test_data)
    print(f"Compressed size: {compressed.compressed_size} bytes")
    print(f"Compression ratio: {compressed.ratio:.2f}x")
    
    decompressed = lz4.decompress(compressed.data)
    print(f"Decompressed size: {decompressed.decompressed_size} bytes")
    print(f"Data integrity: {'OK' if decompressed.data == test_data else 'FAILED'}")
