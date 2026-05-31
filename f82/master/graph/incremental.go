package graph

import (
	"container/list"
	"sync"
	"time"
)

type ChangeType int

const (
	ChangeAddEdge ChangeType = iota
	ChangeRemoveEdge
	ChangeAddNode
	ChangeRemoveNode
)

type GraphChange struct {
	Type      ChangeType
	From      int64
	To        int64
	Node      int64
	Timestamp time.Time
}

type IncrementalGraph struct {
	*Graph
	changeHistory []GraphChange
	lastFullIteration int32
	incrementalMode bool
	mu sync.RWMutex
}

type AffectedSet struct {
	Nodes          map[int64]bool
	InEdges        map[int64][]Edge
	OutEdges       map[int64][]Edge
	ChangeEdges    []Edge
	PropagationLevel int
}

func NewIncrementalGraph() *IncrementalGraph {
	return &IncrementalGraph{
		Graph:            NewGraph(),
		changeHistory:    make([]GraphChange, 0),
		incrementalMode:  false,
		lastFullIteration: -1,
	}
}

func (ig *IncrementalGraph) EnableIncrementalMode() {
	ig.mu.Lock()
	defer ig.mu.Unlock()
	ig.incrementalMode = true
}

func (ig *IncrementalGraph) DisableIncrementalMode() {
	ig.mu.Lock()
	defer ig.mu.Unlock()
	ig.incrementalMode = false
}

func (ig *IncrementalGraph) IsIncrementalMode() bool {
	ig.mu.RLock()
	defer ig.mu.RUnlock()
	return ig.incrementalMode
}

func (ig *IncrementalGraph) AddEdgeIncremental(from, to int64) error {
	ig.mu.Lock()
	defer ig.mu.Unlock()

	if ig.edgeExists(from, to) {
		return nil
	}

	ig.Graph.AddNode(from)
	ig.Graph.AddNode(to)

	ig.Graph.Edges[from] = append(ig.Graph.Edges[from], to)
	ig.Graph.OutDegree[from]++
	ig.Graph.InDegree[to]++

	ig.changeHistory = append(ig.changeHistory, GraphChange{
		Type:      ChangeAddEdge,
		From:      from,
		To:        to,
		Timestamp: time.Now(),
	})

	return nil
}

func (ig *IncrementalGraph) RemoveEdge(from, to int64) bool {
	ig.mu.Lock()
	defer ig.mu.Unlock()

	edges, exists := ig.Graph.Edges[from]
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

	ig.Graph.Edges[from] = newEdges
	ig.Graph.OutDegree[from]--
	ig.Graph.InDegree[to]--

	ig.changeHistory = append(ig.changeHistory, GraphChange{
		Type:      ChangeRemoveEdge,
		From:      from,
		To:        to,
		Timestamp: time.Now(),
	})

	return true
}

func (ig *IncrementalGraph) AddNodeIncremental(node int64) {
	ig.mu.Lock()
	defer ig.mu.Unlock()

	ig.Graph.AddNode(node)

	ig.changeHistory = append(ig.changeHistory, GraphChange{
		Type:      ChangeAddNode,
		Node:      node,
		Timestamp: time.Now(),
	})
}

func (ig *IncrementalGraph) edgeExists(from, to int64) bool {
	edges, exists := ig.Graph.Edges[from]
	if !exists {
		return false
	}
	for _, node := range edges {
		if node == to {
			return true
		}
	}
	return false
}

func (ig *IncrementalGraph) GetAffectedNodes(maxPropagation int) *AffectedSet {
	ig.mu.RLock()
	defer ig.mu.RUnlock()

	if len(ig.changeHistory) == 0 {
		return &AffectedSet{
			Nodes:    make(map[int64]bool),
			InEdges:  make(map[int64][]Edge),
			OutEdges: make(map[int64][]Edge),
		}
	}

	affected := &AffectedSet{
		Nodes:          make(map[int64]bool),
		InEdges:        make(map[int64][]Edge),
		OutEdges:       make(map[int64][]Edge),
		ChangeEdges:    make([]Edge, 0),
		PropagationLevel: maxPropagation,
	}

	for _, change := range ig.changeHistory {
		switch change.Type {
		case ChangeAddEdge, ChangeRemoveEdge:
			affected.ChangeEdges = append(affected.ChangeEdges, Edge{
				From: change.From,
				To:   change.To,
			})
			affected.Nodes[change.From] = true
			affected.Nodes[change.To] = true

			ig.propagateAffected(change.To, maxPropagation, affected, 0)
			ig.propagateAffected(change.From, maxPropagation, affected, 0)

		case ChangeAddNode, ChangeRemoveNode:
			affected.Nodes[change.Node] = true
			ig.propagateAffected(change.Node, maxPropagation, affected, 0)
		}
	}

	for node := range affected.Nodes {
		affected.InEdges[node] = ig.getInEdges(node)
		affected.OutEdges[node] = ig.getOutEdges(node)
	}

	return affected
}

func (ig *IncrementalGraph) propagateAffected(start int64, maxLevel int, affected *AffectedSet, currentLevel int) {
	if currentLevel >= maxLevel {
		return
	}

	queue := list.New()
	queue.PushBack(start)

	visited := make(map[int64]int)
	visited[start] = 0

	for queue.Len() > 0 {
		element := queue.Front()
		queue.Remove(element)
		node := element.Value.(int64)
		level := visited[node]

		if level >= maxLevel {
			continue
		}

		outNeighbors := ig.Graph.Edges[node]
		for _, neighbor := range outNeighbors {
			if _, exists := visited[neighbor]; !exists {
				visited[neighbor] = level + 1
				affected.Nodes[neighbor] = true
				queue.PushBack(neighbor)
			}
		}

		inNeighbors := ig.getInNeighbors(node)
		for _, neighbor := range inNeighbors {
			if _, exists := visited[neighbor]; !exists {
				visited[neighbor] = level + 1
				affected.Nodes[neighbor] = true
				queue.PushBack(neighbor)
			}
		}
	}
}

func (ig *IncrementalGraph) getInNeighbors(node int64) []int64 {
	neighbors := make([]int64, 0)
	for from, toList := range ig.Graph.Edges {
		for _, to := range toList {
			if to == node {
				neighbors = append(neighbors, from)
				break
			}
		}
	}
	return neighbors
}

func (ig *IncrementalGraph) getInEdges(node int64) []Edge {
	edges := make([]Edge, 0)
	for from, toList := range ig.Graph.Edges {
		for _, to := range toList {
			if to == node {
				edges = append(edges, Edge{From: from, To: to})
			}
		}
	}
	return edges
}

func (ig *IncrementalGraph) getOutEdges(node int64) []Edge {
	edges := make([]Edge, 0)
	for _, to := range ig.Graph.Edges[node] {
		edges = append(edges, Edge{From: node, To: to})
	}
	return edges
}

func (ig *IncrementalGraph) ClearChangeHistory() {
	ig.mu.Lock()
	defer ig.mu.Unlock()
	ig.changeHistory = make([]GraphChange, 0)
}

func (ig *IncrementalGraph) GetChangeHistory() []GraphChange {
	ig.mu.RLock()
	defer ig.mu.RUnlock()
	history := make([]GraphChange, len(ig.changeHistory))
	copy(history, ig.changeHistory)
	return history
}

func (ig *IncrementalGraph) GetPendingChanges() int {
	ig.mu.RLock()
	defer ig.mu.RUnlock()
	return len(ig.changeHistory)
}

func (ig *IncrementalGraph) SetLastFullIteration(iteration int32) {
	ig.mu.Lock()
	defer ig.mu.Unlock()
	ig.lastFullIteration = iteration
}

func (ig *IncrementalGraph) GetLastFullIteration() int32 {
	ig.mu.RLock()
	defer ig.mu.RUnlock()
	return ig.lastFullIteration
}

func (ig *IncrementalGraph) BatchAddEdges(edges []Edge) int {
	ig.mu.Lock()
	defer ig.mu.Unlock()

	added := 0
	for _, edge := range edges {
		if ig.edgeExists(edge.From, edge.To) {
			continue
		}

		ig.Graph.AddNode(edge.From)
		ig.Graph.AddNode(edge.To)

		ig.Graph.Edges[edge.From] = append(ig.Graph.Edges[edge.From], edge.To)
		ig.Graph.OutDegree[edge.From]++
		ig.Graph.InDegree[edge.To]++

		ig.changeHistory = append(ig.changeHistory, GraphChange{
			Type:      ChangeAddEdge,
			From:      edge.From,
			To:        edge.To,
			Timestamp: time.Now(),
		})
		added++
	}

	return added
}

func (ig *IncrementalGraph) BatchRemoveEdges(edges []Edge) int {
	ig.mu.Lock()
	defer ig.mu.Unlock()

	removed := 0
	for _, edge := range edges {
		edgesList, exists := ig.Graph.Edges[edge.From]
		if !exists {
			continue
		}

		found := false
		newEdges := make([]int64, 0, len(edgesList))
		for _, to := range edgesList {
			if to == edge.To && !found {
				found = true
				continue
			}
			newEdges = append(newEdges, to)
		}

		if found {
			ig.Graph.Edges[edge.From] = newEdges
			ig.Graph.OutDegree[edge.From]--
			ig.Graph.InDegree[edge.To]--

			ig.changeHistory = append(ig.changeHistory, GraphChange{
				Type:      ChangeRemoveEdge,
				From:      edge.From,
				To:        edge.To,
				Timestamp: time.Now(),
			})
			removed++
		}
	}

	return removed
}

func (as *AffectedSet) GetNodesList() []int64 {
	nodes := make([]int64, 0, len(as.Nodes))
	for node := range as.Nodes {
		nodes = append(nodes, node)
	}
	return nodes
}

func (as *AffectedSet) Count() int {
	return len(as.Nodes)
}

func (as *AffectedSet) Contains(node int64) bool {
	return as.Nodes[node]
}

func (as *AffectedSet) IntersectWith(nodes []int64) []int64 {
	result := make([]int64, 0)
	for _, node := range nodes {
		if as.Nodes[node] {
			result = append(result, node)
		}
	}
	return result
}
