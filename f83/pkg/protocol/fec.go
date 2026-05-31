package protocol

import (
	"errors"
)

type FECConfig struct {
	DataBlocks   int
	ParityBlocks int
}

var (
	DefaultFEC = FECConfig{DataBlocks: 10, ParityBlocks: 2}
)

type FECEncoder struct {
	config FECConfig
}

func NewFECEncoder(config FECConfig) *FECEncoder {
	return &FECEncoder{config: config}
}

func (e *FECEncoder) Encode(dataBlocks [][]byte) ([][]byte, error) {
	if len(dataBlocks) != e.config.DataBlocks {
		return nil, errors.New("incorrect number of data blocks")
	}

	blockSize := len(dataBlocks[0])
	for _, block := range dataBlocks {
		if len(block) != blockSize {
			return nil, errors.New("all data blocks must have the same size")
		}
	}

	parity := make([][]byte, e.config.ParityBlocks)
	for i := range parity {
		parity[i] = make([]byte, blockSize)
	}

	for row := 0; row < blockSize; row++ {
		for col := 0; col < e.config.DataBlocks; col++ {
			byteVal := dataBlocks[col][row]
			
			parity[0][row] ^= byteVal
			
			coeff := byte(col + 1)
			multiplied := gfMul(byteVal, coeff)
			parity[1][row] ^= multiplied
			
			for p := 2; p < e.config.ParityBlocks; p++ {
				coeffP := byte((col + 1) * (p + 1))
				parity[p][row] ^= gfMul(byteVal, coeffP)
			}
		}
	}

	result := make([][]byte, e.config.DataBlocks+e.config.ParityBlocks)
	copy(result, dataBlocks)
	copy(result[e.config.DataBlocks:], parity)

	return result, nil
}

type FECDecoder struct {
	config FECConfig
}

func NewFECDecoder(config FECConfig) *FECDecoder {
	return &FECDecoder{config: config}
}

func (d *FECDecoder) Decode(blocks [][]byte, dataIndices []int, parityIndices []int, missingCount int) ([][]byte, error) {
	totalBlocks := d.config.DataBlocks + d.config.ParityBlocks
	if len(blocks) != totalBlocks {
		return nil, errors.New("incorrect number of blocks")
	}

	if missingCount == 0 {
		return blocks[:d.config.DataBlocks], nil
	}

	if missingCount > d.config.ParityBlocks {
		return nil, errors.New("too many missing blocks")
	}

	blockSize := 0
	for _, b := range blocks {
		if b != nil {
			blockSize = len(b)
			break
		}
	}

	missingIndices := make([]int, 0, missingCount)
	presentIndices := make([]int, 0, totalBlocks-missingCount)

	for i := 0; i < totalBlocks; i++ {
		if blocks[i] == nil {
			missingIndices = append(missingIndices, i)
		} else {
			presentIndices = append(presentIndices, i)
		}
	}

	for _, missingIdx := range missingIndices {
		blocks[missingIdx] = make([]byte, blockSize)
	}

	if missingCount == 1 {
		d.recoverSingle(blocks, missingIndices[0], blockSize)
	} else if missingCount == 2 && d.config.ParityBlocks >= 2 {
		d.recoverDouble(blocks, missingIndices, blockSize)
	} else {
		return nil, errors.New("unsupported recovery scenario")
	}

	return blocks[:d.config.DataBlocks], nil
}

func (d *FECDecoder) recoverSingle(blocks [][]byte, missingIdx int, blockSize int) {
	totalBlocks := d.config.DataBlocks + d.config.ParityBlocks
	parityIdx := d.config.DataBlocks

	for row := 0; row < blockSize; row++ {
		xorSum := byte(0)
		
		for i := 0; i < totalBlocks; i++ {
			if i == missingIdx || i == parityIdx {
				continue
			}
			if i < d.config.DataBlocks {
				xorSum ^= blocks[i][row]
			} else if i > parityIdx {
				idx := i - d.config.DataBlocks
				coeff := byte(idx + 2)
				for j := 0; j < d.config.DataBlocks; j++ {
					if j == missingIdx {
						continue
					}
					xorSum ^= gfMul(blocks[j][row], byte((j+1)*int(coeff)))
				}
			}
		}

		parityVal := blocks[parityIdx][row]
		blocks[missingIdx][row] = xorSum ^ parityVal
	}
}

func (d *FECDecoder) recoverDouble(blocks [][]byte, missingIndices []int, blockSize int) {
	m1, m2 := missingIndices[0], missingIndices[1]
	dataSize := d.config.DataBlocks

	for row := 0; row < blockSize; row++ {
		p0 := blocks[dataSize][row]
		p1 := blocks[dataSize+1][row]

		sum0 := byte(0)
		sum1 := byte(0)

		for i := 0; i < dataSize; i++ {
			if i == m1 || i == m2 {
				continue
			}
			sum0 ^= blocks[i][row]
			sum1 ^= gfMul(blocks[i][row], byte(i+1))
		}

		a := byte(1)
		b := byte(1)
		c := byte(m1 + 1)
		dcoeff := byte(m2 + 1)

		if m1 >= dataSize {
			a = 0
			c = byte(m1 - dataSize + 1)
		}
		if m2 >= dataSize {
			b = 0
			dcoeff = byte(m2 - dataSize + 1)
		}

		eq0_rhs := p0 ^ sum0
		eq1_rhs := p1 ^ sum1

		det := gfMul(a, dcoeff) ^ gfMul(b, c)
		detInv := gfInv(det)

		x := gfMul(gfMul(dcoeff, eq0_rhs) ^ gfMul(b, eq1_rhs), detInv)
		y := gfMul(gfMul(a, eq1_rhs) ^ gfMul(c, eq0_rhs), detInv)

		if m1 < dataSize {
			blocks[m1][row] = x
		}
		if m2 < dataSize {
			blocks[m2][row] = y
		}
	}
}

func gfMul(a, b byte) byte {
	result := byte(0)
	aa, bb := a, b

	for bb != 0 {
		if bb&1 != 0 {
			result ^= aa
		}
		
		highBit := aa & 0x80
		aa <<= 1
		if highBit != 0 {
			aa ^= 0x1b
		}
		
		bb >>= 1
	}

	return result
}

var gfLogTable = [256]byte{}
var gfExpTable = [256]byte{}

func initGFTables() {
	x := byte(1)
	for i := 0; i < 255; i++ {
		gfExpTable[i] = x
		gfLogTable[x] = byte(i)
		x = gfMul(x, 2)
	}
	gfExpTable[255] = gfExpTable[0]
}

func init() {
	initGFTables()
}

func gfInv(a byte) byte {
	if a == 0 {
		return 0
	}
	return gfExpTable[255-int(gfLogTable[a])]
}

func AdaptiveFECConfig(lossRate float64) FECConfig {
	switch {
	case lossRate < 0.01:
		return FECConfig{DataBlocks: 20, ParityBlocks: 1}
	case lossRate < 0.05:
		return FECConfig{DataBlocks: 15, ParityBlocks: 2}
	case lossRate < 0.10:
		return FECConfig{DataBlocks: 12, ParityBlocks: 2}
	case lossRate < 0.15:
		return FECConfig{DataBlocks: 10, ParityBlocks: 2}
	case lossRate < 0.25:
		return FECConfig{DataBlocks: 8, ParityBlocks: 3}
	case lossRate < 0.40:
		return FECConfig{DataBlocks: 6, ParityBlocks: 4}
	default:
		return FECConfig{DataBlocks: 4, ParityBlocks: 4}
	}
}
