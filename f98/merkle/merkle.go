package merkle

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

type MerkleTree struct {
	Root       []byte
	Leaves     [][]byte
	Levels     [][][]byte
}

func NewMerkleTree(leaves [][]byte) *MerkleTree {
	if len(leaves) == 0 {
		return &MerkleTree{
			Root:   make([]byte, 32),
			Leaves: leaves,
			Levels: [][][]byte{{}},
		}
	}

	level := make([][]byte, len(leaves))
	copy(level, leaves)

	levels := [][][]byte{level}

	for len(level) > 1 {
		nextLevel := make([][]byte, 0)
		for i := 0; i < len(level); i += 2 {
			var left, right []byte
			left = level[i]
			if i+1 < len(level) {
				right = level[i+1]
			} else {
				right = left
			}
			hash := HashPair(left, right)
			nextLevel = append(nextLevel, hash)
		}
		levels = append(levels, nextLevel)
		level = nextLevel
	}

	return &MerkleTree{
		Root:   level[0],
		Leaves: leaves,
		Levels: levels,
	}
}

func HashLeaf(data []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x00})
	h.Write(data)
	return h.Sum(nil)
}

func HashPair(left, right []byte) []byte {
	h := sha256.New()
	h.Write([]byte{0x01})
	if bytes.Compare(left, right) <= 0 {
		h.Write(left)
		h.Write(right)
	} else {
		h.Write(right)
		h.Write(left)
	}
	return h.Sum(nil)
}

type Proof struct {
	Path     [][]byte
	Index    int
	Leaf     []byte
}

func (mt *MerkleTree) GenerateProof(index int) (*Proof, error) {
	if index < 0 || index >= len(mt.Leaves) {
		return nil, errors.New("index out of bounds")
	}

	proof := &Proof{
		Path:  make([][]byte, 0),
		Index: index,
		Leaf:  mt.Leaves[index],
	}

	currentIndex := index
	for level := 0; level < len(mt.Levels)-1; level++ {
		currentLevel := mt.Levels[level]
		var sibling []byte

		if currentIndex%2 == 0 {
			if currentIndex+1 < len(currentLevel) {
				sibling = currentLevel[currentIndex+1]
			} else {
				sibling = currentLevel[currentIndex]
			}
		} else {
			sibling = currentLevel[currentIndex-1]
		}

		proof.Path = append(proof.Path, sibling)
		currentIndex = currentIndex / 2
	}

	return proof, nil
}

func VerifyProof(root []byte, proof *Proof) bool {
	current := proof.Leaf
	currentIndex := proof.Index

	for _, sibling := range proof.Path {
		if currentIndex%2 == 0 {
			current = HashPair(current, sibling)
		} else {
			current = HashPair(sibling, current)
		}
		currentIndex = currentIndex / 2
	}

	return bytes.Equal(current, root)
}

func PubKeyToLeaf(pubKey []byte) []byte {
	return HashLeaf(pubKey)
}

func PubKeyHashToHex(pubKey []byte) string {
	return hex.EncodeToString(HashLeaf(pubKey))
}

func (mt *MerkleTree) RootHex() string {
	return hex.EncodeToString(mt.Root)
}

func HexToRoot(hexStr string) ([]byte, error) {
	return hex.DecodeString(hexStr)
}
