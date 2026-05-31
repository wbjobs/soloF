#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>

#define LZ4_MIN_MATCH 4
#define LZ4_HASH_LOG 16
#define LZ4_HASH_SIZE (1 << LZ4_HASH_LOG)
#define LZ4_HASH_MASK (LZ4_HASH_SIZE - 1)
#define LZ4_MAX_DISTANCE 65535
#define LZ4_DICT_SIZE 65536

static inline uint32_t lz4_hash(const uint8_t* data) {
    uint32_t v = *(const uint32_t*)data;
    return ((v * 2654435761U) >> (32 - LZ4_HASH_LOG)) & LZ4_HASH_MASK;
}

class LZ4Compressor {
private:
    std::vector<uint16_t> hashTable;
    std::vector<uint8_t> dictionary;
    bool useDict;

public:
    LZ4Compressor() : hashTable(LZ4_HASH_SIZE, 0), useDict(false) {}

    void setDictionary(const uint8_t* dict, size_t dictSize) {
        dictionary.assign(dict, dict + dictSize);
        useDict = true;
    }

    size_t compressBound(size_t inputSize) {
        return inputSize + (inputSize / 255) + 16;
    }

    size_t compress(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        if (srcSize < LZ4_MIN_MATCH) {
            if (dstCapacity < srcSize + 1) return 0;
            *dst++ = static_cast<uint8_t>(srcSize);
            memcpy(dst, src, srcSize);
            return srcSize + 1;
        }

        std::fill(hashTable.begin(), hashTable.end(), 0);
        
        const uint8_t* anchor = src;
        const uint8_t* ip = src;
        const uint8_t* iend = src + srcSize;
        const uint8_t* mflimit = iend - LZ4_MIN_MATCH;
        uint8_t* op = dst;

        while (ip < mflimit) {
            uint32_t h = lz4_hash(ip);
            uint16_t& entry = hashTable[h];
            const uint8_t* match = src + entry;

            entry = static_cast<uint16_t>(ip - src);

            if (entry == 0 || match < src || 
                (ip - match) > LZ4_MAX_DISTANCE ||
                *(const uint32_t*)match != *(const uint32_t*)ip) {
                ip++;
                continue;
            }

            size_t literalLen = ip - anchor;
            size_t offset = ip - match;

            const uint8_t* matchPtr = match;
            const uint8_t* ipStart = ip;
            while (ip < iend && *ip == *matchPtr) {
                ip++;
                matchPtr++;
            }
            size_t matchLen = ip - ipStart;

            size_t token = (literalLen < 15 ? literalLen : 15) << 4;
            token |= (matchLen - 4 < 15 ? matchLen - 4 : 15);
            *op++ = static_cast<uint8_t>(token);

            if (literalLen >= 15) {
                size_t len = literalLen - 15;
                while (len >= 255) {
                    *op++ = 255;
                    len -= 255;
                }
                *op++ = static_cast<uint8_t>(len);
            }

            memcpy(op, anchor, literalLen);
            op += literalLen;

            *op++ = static_cast<uint8_t>(offset & 0xFF);
            *op++ = static_cast<uint8_t>(offset >> 8);

            if (matchLen - 4 >= 15) {
                size_t len = matchLen - 4 - 15;
                while (len >= 255) {
                    *op++ = 255;
                    len -= 255;
                }
                *op++ = static_cast<uint8_t>(len);
            }

            anchor = ip;
        }

        size_t literalLen = iend - anchor;
        size_t token = (literalLen < 15 ? literalLen : 15) << 4;
        *op++ = static_cast<uint8_t>(token);

        if (literalLen >= 15) {
            size_t len = literalLen - 15;
            while (len >= 255) {
                *op++ = 255;
                len -= 255;
            }
            *op++ = static_cast<uint8_t>(len);
        }

        memcpy(op, anchor, literalLen);
        op += literalLen;

        return op - dst;
    }

    size_t decompress(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        const uint8_t* ip = src;
        const uint8_t* iend = src + srcSize;
        uint8_t* op = dst;
        uint8_t* oend = dst + dstCapacity;

        while (ip < iend) {
            uint8_t token = *ip++;
            size_t literalLen = token >> 4;
            size_t matchLen = (token & 0x0F) + 4;

            if (literalLen == 15) {
                while (ip < iend && *ip == 255) {
                    literalLen += 255;
                    ip++;
                }
                if (ip < iend) {
                    literalLen += *ip++;
                }
            }

            if (op + literalLen > oend) return 0;
            memcpy(op, ip, literalLen);
            op += literalLen;
            ip += literalLen;

            if (ip >= iend) break;

            size_t offset = *ip++;
            offset |= (size_t)*ip++ << 8;

            if (matchLen == 19) {
                while (ip < iend && *ip == 255) {
                    matchLen += 255;
                    ip++;
                }
                if (ip < iend) {
                    matchLen += *ip++;
                }
            }

            if (op + matchLen > oend) return 0;
            uint8_t* copyFrom = op - offset;
            if (copyFrom < dst) return 0;

            if (offset == 1) {
                uint8_t v = *copyFrom;
                for (size_t i = 0; i < matchLen; i++) {
                    *op++ = v;
                }
            } else {
                for (size_t i = 0; i < matchLen; i++) {
                    *op++ = *copyFrom++;
                }
            }
        }

        return op - dst;
    }
};

static LZ4Compressor compressor;

extern "C" {
    size_t lz4_compress_bound(size_t inputSize) {
        return compressor.compressBound(inputSize);
    }

    size_t lz4_compress(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        return compressor.compress(src, srcSize, dst, dstCapacity);
    }

    size_t lz4_decompress(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        return compressor.decompress(src, srcSize, dst, dstCapacity);
    }

    void lz4_set_dictionary(const uint8_t* dict, size_t dictSize) {
        compressor.setDictionary(dict, dictSize);
    }

    size_t lz4_compress_chunk(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        return compressor.compress(src, srcSize, dst, dstCapacity);
    }

    size_t lz4_decompress_chunk(const uint8_t* src, size_t srcSize, uint8_t* dst, size_t dstCapacity) {
        return compressor.decompress(src, srcSize, dst, dstCapacity);
    }
}
