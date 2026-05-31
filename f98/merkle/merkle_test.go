package merkle

import (
	"encoding/hex"
	"testing"
)

func TestNewMerkleTree(t *testing.T) {
	leaves := [][]byte{
		[]byte("leaf1"),
		[]byte("leaf2"),
		[]byte("leaf3"),
		[]byte("leaf4"),
	}

	hashedLeaves := make([][]byte, len(leaves))
	for i, leaf := range leaves {
		hashedLeaves[i] = HashLeaf(leaf)
	}

	mt := NewMerkleTree(hashedLeaves)

	if mt.Root == nil {
		t.Error("Merkle root should not be nil")
	}

	if len(mt.Leaves) != 4 {
		t.Errorf("Expected 4 leaves, got %d", len(mt.Leaves))
	}
}

func TestGenerateAndVerifyProof(t *testing.T) {
	leaves := [][]byte{
		HashLeaf([]byte("leaf1")),
		HashLeaf([]byte("leaf2")),
		HashLeaf([]byte("leaf3")),
		HashLeaf([]byte("leaf4")),
		HashLeaf([]byte("leaf5")),
	}

	mt := NewMerkleTree(leaves)

	for i := range leaves {
		proof, err := mt.GenerateProof(i)
		if err != nil {
			t.Errorf("Failed to generate proof for index %d: %v", i, err)
			continue
		}

		valid := VerifyProof(mt.Root, proof)
		if !valid {
			t.Errorf("Proof verification failed for index %d", i)
		}
	}
}

func TestProofTamper(t *testing.T) {
	leaves := [][]byte{
		HashLeaf([]byte("leaf1")),
		HashLeaf([]byte("leaf2")),
	}

	mt := NewMerkleTree(leaves)

	proof, _ := mt.GenerateProof(0)
	proof.Leaf = HashLeaf([]byte("tampered"))

	valid := VerifyProof(mt.Root, proof)
	if valid {
		t.Error("Tampered proof should not verify")
	}
}

func TestPubKeyToLeaf(t *testing.T) {
	pubKey := []byte("test-public-key-12345")
	leaf := PubKeyToLeaf(pubKey)

	if len(leaf) != 32 {
		t.Errorf("Expected leaf length 32, got %d", len(leaf))
	}
}

func TestRootHex(t *testing.T) {
	leaves := [][]byte{
		HashLeaf([]byte("leaf1")),
		HashLeaf([]byte("leaf2")),
	}

	mt := NewMerkleTree(leaves)
	rootHex := mt.RootHex()

	decoded, err := hex.DecodeString(rootHex)
	if err != nil {
		t.Error("Failed to decode hex root")
	}

	if hex.EncodeToString(decoded) != rootHex {
		t.Error("Hex encoding/decoding mismatch")
	}
}

func TestEmptyTree(t *testing.T) {
	mt := NewMerkleTree([][]byte{})

	if mt.Root == nil {
		t.Error("Empty tree should have a root")
	}

	if len(mt.Leaves) != 0 {
		t.Error("Empty tree should have 0 leaves")
	}
}

func TestMerkleTreeConsistency(t *testing.T) {
	leaves := [][]byte{
		HashLeaf([]byte("a")),
		HashLeaf([]byte("b")),
		HashLeaf([]byte("c")),
		HashLeaf([]byte("d")),
	}

	mt1 := NewMerkleTree(leaves)
	mt2 := NewMerkleTree(leaves)

	if hex.EncodeToString(mt1.Root) != hex.EncodeToString(mt2.Root) {
		t.Error("Same leaves should produce same root")
	}
}

func TestDifferentLeavesDifferentRoot(t *testing.T) {
	leaves1 := [][]byte{
		HashLeaf([]byte("a")),
		HashLeaf([]byte("b")),
	}

	leaves2 := [][]byte{
		HashLeaf([]byte("a")),
		HashLeaf([]byte("c")),
	}

	mt1 := NewMerkleTree(leaves1)
	mt2 := NewMerkleTree(leaves2)

	if hex.EncodeToString(mt1.Root) == hex.EncodeToString(mt2.Root) {
		t.Error("Different leaves should produce different roots")
	}
}

func TestPubKeyHashToHex(t *testing.T) {
	pubKey := []byte("test-key")
	hash := PubKeyHashToHex(pubKey)

	if len(hash) != 64 {
		t.Errorf("Expected hex length 64, got %d", len(hash))
	}
}

func BenchmarkMerkleTree(b *testing.B) {
	leaves := make([][]byte, 1000)
	for i := range leaves {
		leaves[i] = HashLeaf([]byte("leaf" + string(rune(i))))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewMerkleTree(leaves)
	}
}
