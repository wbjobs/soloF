package circuits

import (
	"github.com/consensys/gnark/frontend"
)

type AggregateCircuit struct {
	Nullifiers   []frontend.Variable `gnark:",public"`
	Nonces       []frontend.Variable `gnark:",public"`
	MerkleRoot   frontend.Variable   `gnark:",public"`
	Count1       frontend.Variable   `gnark:",public"`
	Count2       frontend.Variable   `gnark:",public"`
	Count3       frontend.Variable   `gnark:",public"`

	Votes        []frontend.Variable `gnark:",secret"`
	PubKeyHashes []frontend.Variable `gnark:",secret"`
	MerklePaths  [][]frontend.Variable
	MerkleIndices []frontend.Variable `gnark:",secret"`
}

func NewAggregateCircuit(numVotes int, merkleDepth int) *AggregateCircuit {
	merklePaths := make([][]frontend.Variable, numVotes)
	for i := range merklePaths {
		merklePaths[i] = make([]frontend.Variable, merkleDepth)
	}

	return &AggregateCircuit{
		Nullifiers:    make([]frontend.Variable, numVotes),
		Nonces:        make([]frontend.Variable, numVotes),
		Votes:         make([]frontend.Variable, numVotes),
		PubKeyHashes:  make([]frontend.Variable, numVotes),
		MerklePaths:   merklePaths,
		MerkleIndices: make([]frontend.Variable, numVotes),
	}
}

func (circuit *AggregateCircuit) Define(api frontend.API) error {
	numVotes := len(circuit.Votes)

	var sum1, sum2, sum3 frontend.Variable = 0, 0, 0

	for i := 0; i < numVotes; i++ {
		v := circuit.Votes[i]

		vMinus1 := api.Sub(v, 1)
		vMinus2 := api.Sub(v, 2)
		vMinus3 := api.Sub(v, 3)
		vInRange := api.Mul(vMinus1, api.Mul(vMinus2, vMinus3))
		api.AssertIsEqual(vInRange, 0)

		v1Flag := api.IsZero(api.Mul(vMinus2, vMinus3))
		v2Flag := api.IsZero(api.Mul(vMinus1, vMinus3))
		v3Flag := api.IsZero(api.Mul(vMinus1, vMinus2))
		api.AssertIsEqual(api.Add(api.Add(v1Flag, v2Flag), v3Flag), 1)

		nullifier := api.Add(api.Add(api.Mul(circuit.PubKeyHashes[i], v), circuit.Nonces[i]), api.Mul(v, circuit.Nonces[i]))
		api.AssertIsEqual(circuit.Nullifiers[i], nullifier)

		current := circuit.PubKeyHashes[i]
		currentIndex := circuit.MerkleIndices[i]

		for _, sibling := range circuit.MerklePaths[i] {
			bit := api.And(currentIndex, 1)

			left := api.Select(bit, sibling, current)
			right := api.Select(bit, current, sibling)

			current = hashPairOptimized(api, left, right)
			currentIndex = api.Rsh(currentIndex, 1)
		}

		api.AssertIsEqual(current, circuit.MerkleRoot)

		sum1 = api.Add(sum1, v1Flag)
		sum2 = api.Add(sum2, v2Flag)
		sum3 = api.Add(sum3, v3Flag)
	}

	api.AssertIsEqual(sum1, circuit.Count1)
	api.AssertIsEqual(sum2, circuit.Count2)
	api.AssertIsEqual(sum3, circuit.Count3)

	return nil
}
