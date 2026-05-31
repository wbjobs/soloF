package zk

import (
	"bytes"
	"crypto/rand"
	"encoding/gob"
	"encoding/hex"
	"errors"
	"os"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"zk-voting-system/circuits"
)

type VoteProof struct {
	Proof      groth16.Proof
	Nullifier  []byte
	Nonce      []byte
	MerkleRoot []byte
}

type SetupOutput struct {
	PK   groth16.ProvingKey
	VK   groth16.VerifyingKey
	CS   constraint.ConstraintSystem
}

func SetupVoteCircuit(merkleDepth int) (*SetupOutput, error) {
	circuit := circuits.NewVoteCircuit(merkleDepth)

	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
	if err != nil {
		return nil, err
	}

	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return nil, err
	}

	return &SetupOutput{
		PK: pk,
		VK: vk,
		CS: ccs,
	}, nil
}

func SetupAggregateCircuit(numVotes int, merkleDepth int) (*SetupOutput, error) {
	circuit := circuits.NewAggregateCircuit(numVotes, merkleDepth)

	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
	if err != nil {
		return nil, err
	}

	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		return nil, err
	}

	return &SetupOutput{
		PK: pk,
		VK: vk,
		CS: ccs,
	}, nil
}

func GenerateNonce() ([]byte, error) {
	nonceBytes := make([]byte, 32)
	_, err := rand.Read(nonceBytes)
	if err != nil {
		return nil, err
	}
	return nonceBytes, nil
}

func GenerateVoteProof(
	setup *SetupOutput,
	vote int,
	pubKeyHash []byte,
	nonce []byte,
	merkleRoot []byte,
	merklePath [][]byte,
	merkleIndex int,
) (*VoteProof, error) {
	if vote < 1 || vote > 3 {
		return nil, errors.New("vote must be 1, 2, or 3")
	}

	merkleDepth := len(merklePath)
	assignment := &circuits.VoteCircuit{
		Vote:        vote,
		Nullifier:   computeNullifierWithNonce(pubKeyHash, nonce, vote),
		Nonce:       bytesToFr(nonce),
		MerkleRoot:  bytesToFr(merkleRoot),
		MerklePath:  make([]frontend.Variable, merkleDepth),
		MerkleIndex: merkleIndex,
		PubKeyHash:  bytesToFr(pubKeyHash),
	}

	for i, sibling := range merklePath {
		assignment.MerklePath[i] = bytesToFr(sibling)
	}

	witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return nil, err
	}

	proof, err := groth16.Prove(setup.CS, setup.PK, witness)
	if err != nil {
		return nil, err
	}

	return &VoteProof{
		Proof:      proof,
		Nullifier:  computeNullifierBytesWithNonce(pubKeyHash, nonce, vote),
		Nonce:      nonce,
		MerkleRoot: merkleRoot,
	}, nil
}

func VerifyVoteProof(setup *SetupOutput, proof *VoteProof) (bool, error) {
	publicWitness, err := frontend.NewWitness(
		&circuits.VoteCircuit{
			Nullifier:  bytesToFr(proof.Nullifier),
			Nonce:      bytesToFr(proof.Nonce),
			MerkleRoot: bytesToFr(proof.MerkleRoot),
		},
		ecc.BN254.ScalarField(),
		frontend.PublicOnly(),
	)
	if err != nil {
		return false, err
	}

	err = groth16.Verify(proof.Proof, setup.VK, publicWitness)
	if err != nil {
		return false, nil
	}

	return true, nil
}

func GenerateAggregateProof(
	setup *SetupOutput,
	votes []int,
	pubKeyHashes [][]byte,
	nullifiers [][]byte,
	nonces [][]byte,
	merkleRoot []byte,
	merklePaths [][][]byte,
	merkleIndices []int,
	count1, count2, count3 int,
) (groth16.Proof, error) {
	numVotes := len(votes)
	merkleDepth := len(merklePaths[0])

	assignment := circuits.NewAggregateCircuit(numVotes, merkleDepth)

	assignment.MerkleRoot = bytesToFr(merkleRoot)
	assignment.Count1 = count1
	assignment.Count2 = count2
	assignment.Count3 = count3

	for i := 0; i < numVotes; i++ {
		assignment.Votes[i] = votes[i]
		assignment.PubKeyHashes[i] = bytesToFr(pubKeyHashes[i])
		assignment.Nullifiers[i] = bytesToFr(nullifiers[i])
		assignment.Nonces[i] = bytesToFr(nonces[i])
		assignment.MerkleIndices[i] = merkleIndices[i]

		for j, sibling := range merklePaths[i] {
			assignment.MerklePaths[i][j] = bytesToFr(sibling)
		}
	}

	witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return nil, err
	}

	proof, err := groth16.Prove(setup.CS, setup.PK, witness)
	if err != nil {
		return nil, err
	}

	return proof, nil
}

func VerifyAggregateProof(
	setup *SetupOutput,
	proof groth16.Proof,
	nullifiers [][]byte,
	nonces [][]byte,
	merkleRoot []byte,
	count1, count2, count3 int,
) (bool, error) {
	numVotes := len(nullifiers)
	assignment := &circuits.AggregateCircuit{
		Nullifiers: make([]frontend.Variable, numVotes),
		Nonces:     make([]frontend.Variable, numVotes),
		MerkleRoot: bytesToFr(merkleRoot),
		Count1:     count1,
		Count2:     count2,
		Count3:     count3,
	}

	for i, n := range nullifiers {
		assignment.Nullifiers[i] = bytesToFr(n)
	}
	for i, n := range nonces {
		assignment.Nonces[i] = bytesToFr(n)
	}

	publicWitness, err := frontend.NewWitness(
		assignment,
		ecc.BN254.ScalarField(),
		frontend.PublicOnly(),
	)
	if err != nil {
		return false, err
	}

	err = groth16.Verify(proof, setup.VK, publicWitness)
	if err != nil {
		return false, nil
	}

	return true, nil
}

func bytesToFr(b []byte) frontend.Variable {
	var result uint64
	for i := 0; i < len(b) && i < 8; i++ {
		result = (result << 8) | uint64(b[i])
	}
	return result
}

func computeNullifierWithNonce(pubKeyHash, nonce []byte, vote int) frontend.Variable {
	return bytesToFr(computeNullifierBytesWithNonce(pubKeyHash, nonce, vote))
}

func computeNullifierBytesWithNonce(pubKeyHash, nonce []byte, vote int) []byte {
	result := make([]byte, 32)
	for i := 0; i < 32; i++ {
		pkByte := byte(0)
		nonceByte := byte(0)
		if i < len(pubKeyHash) {
			pkByte = pubKeyHash[i]
		}
		if i < len(nonce) {
			nonceByte = nonce[i]
		}
		result[i] = pkByte ^ nonceByte
	}
	result[0] ^= byte(vote)
	return result
}

func NonceToHex(nonce []byte) string {
	return hex.EncodeToString(nonce)
}

func HexToNonce(hexStr string) ([]byte, error) {
	return hex.DecodeString(hexStr)
}

func SaveSetup(setup *SetupOutput, path string) error {
	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)

	if err := enc.Encode(setup.PK); err != nil {
		return err
	}
	if err := enc.Encode(setup.VK); err != nil {
		return err
	}
	if err := enc.Encode(setup.CS); err != nil {
		return err
	}

	return os.WriteFile(path, buf.Bytes(), 0644)
}

func LoadSetup(path string) (*SetupOutput, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	buf := bytes.NewBuffer(data)
	dec := gob.NewDecoder(buf)

	setup := &SetupOutput{}

	if err := dec.Decode(&setup.PK); err != nil {
		return nil, err
	}
	if err := dec.Decode(&setup.VK); err != nil {
		return nil, err
	}
	if err := dec.Decode(&setup.CS); err != nil {
		return nil, err
	}

	return setup, nil
}
