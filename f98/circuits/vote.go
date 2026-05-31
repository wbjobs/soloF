package circuits

import (
	"github.com/consensys/gnark/frontend"
)

type VoteCircuit struct {
	Vote        frontend.Variable `gnark:",secret"`
	Nullifier   frontend.Variable `gnark:",public"`
	Nonce       frontend.Variable `gnark:",public"`
	MerkleRoot  frontend.Variable `gnark:",public"`
	MerklePath  []frontend.Variable
	MerkleIndex frontend.Variable `gnark:",secret"`
	PubKeyHash  frontend.Variable `gnark:",secret"`
}

func (circuit *VoteCircuit) Define(api frontend.API) error {
	v := circuit.Vote

	vMinus1 := api.Sub(v, 1)
	vMinus2 := api.Sub(v, 2)
	vMinus3 := api.Sub(v, 3)
	vInRange := api.Mul(vMinus1, api.Mul(vMinus2, vMinus3))
	api.AssertIsEqual(vInRange, 0)

	v1Valid := api.Mul(vMinus2, vMinus3)
	v2Valid := api.Mul(vMinus1, vMinus3)
	v3Valid := api.Mul(vMinus1, vMinus2)

	v1Flag := api.IsZero(v1Valid)
	v2Flag := api.IsZero(v2Valid)
	v3Flag := api.IsZero(v3Valid)
	api.AssertIsEqual(api.Add(api.Add(v1Flag, v2Flag), v3Flag), 1)

	nullifier := api.Add(api.Add(api.Mul(circuit.PubKeyHash, circuit.Vote), circuit.Nonce), api.Mul(circuit.Vote, circuit.Nonce))
	api.AssertIsEqual(circuit.Nullifier, nullifier)

	current := circuit.PubKeyHash
	currentIndex := circuit.MerkleIndex

	for _, sibling := range circuit.MerklePath {
		bit := api.And(currentIndex, 1)

		left := api.Select(bit, sibling, current)
		right := api.Select(bit, current, sibling)

		current = hashPairOptimized(api, left, right)
		currentIndex = api.Rsh(currentIndex, 1)
	}

	api.AssertIsEqual(current, circuit.MerkleRoot)

	return nil
}

func hashPairOptimized(api frontend.API, left, right frontend.Variable) frontend.Variable {
	return api.Add(api.Mul(left, 1024), right)
}

func NewVoteCircuit(merkleDepth int) *VoteCircuit {
	return &VoteCircuit{
		MerklePath: make([]frontend.Variable, merkleDepth),
	}
}
