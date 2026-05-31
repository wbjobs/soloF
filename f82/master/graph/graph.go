package graph

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"sync"
)

type Graph struct {
	Nodes []int64
	Edges map[int64][]int64
	InDegree map[int64]int
	OutDegree map[int64]int
	NodeIndex map[int64]int
	mu sync.RWMutex
}

type Partition struct {
	ID int32
	Total int32
	LocalNodes []int64
	Edges []Edge
	GhostNodes []int64
}

type Edge struct {
	From int64 `json:"from"`
	To int64 `json:"to"`
}

func NewGraph() *Graph {
	return &Graph{
		Nodes: make([]int64, 0),
		Edges: make(map[int64][]int64),
		InDegree: make(map[int64]int),
		OutDegree: make(map[int64]int),
		NodeIndex: make(map[int64]int),
	}
}

func (g *Graph) AddNode(node int64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, exists := g.NodeIndex[node]; !exists {
		g.Nodes = append(g.Nodes, node)
		g.NodeIndex[node] = len(g.Nodes) - 1
		g.Edges[node] = make([]int64, 0)
		g.InDegree[node] = 0
		g.OutDegree[node] = 0
	}
}

func (g *Graph) AddEdge(from, to int64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, exists := g.NodeIndex[from]; !exists {
		g.AddNode(from)
	}
	if _, exists := g.NodeIndex[to]; !exists {
		g.AddNode(to)
	}
	g.Edges[from] = append(g.Edges[from], to)
	g.OutDegree[from]++
	g.InDegree[to]++
}

func (g *Graph) RemoveEdge(from, to int64) bool {
	g.mu.Lock()
	defer g.mu.Unlock()

	edges, exists := g.Edges[from]
	if !exists {
		return false
	}

	found := false
	newEdges := make([]int64, 0, len(edges))
	for _, node := range edges {
		if node == to && !found {
			found = true
			continue
		}
		newEdges = append(newEdges, node)
	}

	if !found {
		return false
	}

	g.Edges[from] = newEdges
	g.OutDegree[from]--
	g.InDegree[to]--
	return true
}

func (g *Graph) NodeCount() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.Nodes)
}

func (g *Graph) EdgeCount() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	count := 0
	for _, edges := range g.Edges {
		count += len(edges)
	}
	return count
}

func (g *Graph) GetNeighbors(node int64) []int64 {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Edges[node]
}

func (g *Graph) GetOutDegree(node int64) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.OutDegree[node]
}

func (g *Graph) GetInDegree(node int64) int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.InDegree[node]
}

func (g *Graph) GetAllNodes() []int64 {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.Nodes
}

func (g *Graph) Partitioner(numPartitions int) []*Partition {
	g.mu.RLock()
	defer g.mu.RUnlock()
	nodes := g.Nodes
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i] < nodes[j]
	})
	partitions := make([]*Partition, numPartitions)
	for i := 0; i < numPartitions; i++ {
		partitions[i] = &Partition{
			ID: int32(i),
			Total: int32(numPartitions),
			LocalNodes: make([]int64, 0),
			Edges: make([]Edge, 0),
			GhostNodes: make([]int64, 0),
		}
	}
	chunkSize := (len(nodes) + numPartitions - 1) / numPartitions
	for i, node := range nodes {
		partitionIdx := i / chunkSize
		if partitionIdx >= numPartitions {
			partitionIdx = numPartitions - 1
		}
		partitions[partitionIdx].LocalNodes = append(partitions[partitionIdx].LocalNodes, node)
	}
	ghostSet := make(map[int]map[int64]bool)
	for i := 0; i < numPartitions; i++ {
		ghostSet[i] = make(map[int64]bool)
	}
	for from, toNodes := range g.Edges {
		fromPartition := g.getPartitionID(from, numPartitions, chunkSize)
		for _, to := range toNodes {
			toPartition := g.getPartitionID(to, numPartitions, chunkSize)
			partitions[fromPartition].Edges = append(partitions[fromPartition].Edges, Edge{
				From: from,
				To: to,
			})
			if fromPartition != toPartition {
				if !g.isLocalNode(from, partitions[fromPartition]) {
					ghostSet[fromPartition][from] = true
				}
				if !g.isLocalNode(to, partitions[toPartition]) {
					ghostSet[toPartition][to] = true
				}
			}
		}
	}
	for i := 0; i < numPartitions; i++ {
		for ghostNode := range ghostSet[i] {
			partitions[i].GhostNodes = append(partitions[i].GhostNodes, ghostNode)
		}
		sort.Slice(partitions[i].GhostNodes, func(a, b int) bool {
			return partitions[i].GhostNodes[a] < partitions[i].GhostNodes[b]
		})
	}
	return partitions
}

func (g *Graph) getPartitionID(node int64, numPartitions, chunkSize int) int {
	idx, exists := g.NodeIndex[node]
	if !exists {
		return 0
	}
	partitionID := idx / chunkSize
	if partitionID >= numPartitions {
		partitionID = numPartitions - 1
	}
	return partitionID
}

func (g *Graph) isLocalNode(node int64, partition *Partition) bool {
	for _, n := range partition.LocalNodes {
		if n == node {
			return true
		}
	}
	return false
}

func LoadGraphFromFile(filePath string) (*Graph, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()
	g := NewGraph()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		var from, to int64
		if _, err := fmt.Sscanf(line, "%d %d", &from, &to); err != nil {
			continue
		}
		g.AddEdge(from, to)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading file: %v", err)
	}
	return g, nil
}

func LoadGraphFromJSON(filePath string) (*Graph, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %v", err)
	}
	type graphJSON struct {
		Nodes []int64 `json:"nodes"`
		Edges []Edge  `json:"edges"`
	}
	var gj graphJSON
	if err := json.Unmarshal(data, &gj); err != nil {
		return nil, fmt.Errorf("failed to parse JSON: %v", err)
	}
	g := NewGraph()
	for _, node := range gj.Nodes {
		g.AddNode(node)
	}
	for _, edge := range gj.Edges {
		g.AddEdge(edge.From, edge.To)
	}
	return g, nil
}
