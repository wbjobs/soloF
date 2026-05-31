package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"f82/master/api"
	"f82/master/discovery"
	"f82/master/graph"
	"f82/master/rpc"

	pb "f82/proto/pagerank"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

var (
	grpcPort    = flag.Int("grpc-port", 50051, "gRPC server port")
	httpPort    = flag.Int("http-port", 8080, "HTTP API port")
	etcdAddrs   = flag.String("etcd", "localhost:2379", "etcd endpoints (comma-separated)")
	numWorkers  = flag.Int("workers", 3, "Expected number of workers")
	graphFile   = flag.String("graph", "", "Graph data file path")
)

type MasterNode struct {
	grpcServer *grpc.Server
	apiServer  *api.MasterAPI
	discovery  *discovery.ServiceDiscovery
	rpcServer  *rpc.MasterServer
	graphData  *graph.Graph
	incrementalGraph *graph.IncrementalGraph
	mu         sync.RWMutex
}

func NewMasterNode() *MasterNode {
	return &MasterNode{}
}

func (m *MasterNode) Start() error {
	flag.Parse()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var err error
	m.discovery, err = discovery.NewServiceDiscovery([]string{*etcdAddrs}, 10)
	if err != nil {
		log.Printf("[Warning] Failed to connect to etcd: %v", err)
	} else {
		serviceInfo := &discovery.ServiceInfo{
			ID:   "master",
			Addr: fmt.Sprintf("localhost:%d", *grpcPort),
			Type: "master",
		}
		if err := m.discovery.RegisterService(ctx, serviceInfo); err != nil {
			log.Printf("[Warning] Failed to register master: %v", err)
		}
	}
	m.rpcServer = rpc.NewMasterServer(int32(*numWorkers))
	m.rpcServer.SetCallbacks(
		m.onWorkerReady,
		m.onIterationComplete,
		m.onConverged,
	)
	m.rpcServer.SetOnWorkerFailed(m.onWorkerFailed)
	m.rpcServer.SetOnIncrementalComplete(m.onIncrementalComplete)

	m.incrementalGraph = graph.NewIncrementalGraph()
	m.incrementalGraph.EnableIncrementalMode()
	grpcAddr := fmt.Sprintf(":%d", *grpcPort)
	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %v", grpcAddr, err)
	}
	m.grpcServer = grpc.NewServer()
	pb.RegisterPageRankServiceServer(m.grpcServer, m.rpcServer)
	reflection.Register(m.grpcServer)
	go func() {
		log.Printf("[Master] gRPC server listening on %s", grpcAddr)
		if err := m.grpcServer.Serve(lis); err != nil {
			log.Printf("[Error] gRPC server error: %v", err)
		}
	}()
	m.apiServer = api.NewMasterAPI(m.rpcServer, m)
	go func() {
		httpAddr := fmt.Sprintf(":%d", *httpPort)
		if err := m.apiServer.Run(httpAddr); err != nil {
			log.Printf("[Error] HTTP server error: %v", err)
		}
	}()
	if *graphFile != "" {
		go m.loadGraph(*graphFile)
	}
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("[Master] Received signal %v, shutting down...", sig)
	return m.Shutdown()
}

func (m *MasterNode) onWorkerReady() {
	log.Printf("[Master] All workers ready, distributing graph partitions...")
	if m.graphData != nil {
		go m.distributePartitions()
	}
}

func (m *MasterNode) onIterationComplete(iteration int32, ranks map[int64]float64) {
	log.Printf("[Master] Iteration %d complete, workers: %d, max_delta: %f",
		iteration, m.rpcServer.GetWorkerCount(), m.rpcServer.GetMaxDelta())
	if !m.rpcServer.IsConverged() {
		time.Sleep(100 * time.Millisecond)
		m.rpcServer.StartIteration()
	}
}

func (m *MasterNode) onConverged(ranks map[int64]float64) {
	log.Printf("[Master] PageRank converged! Iteration: %d", m.rpcServer.GetIteration())
}

func (m *MasterNode) onIncrementalComplete(
	iteration int32,
	ranks map[int64]float64,
	affectedNodes []int64,
) {
	log.Printf("[Master] Incremental iteration %d complete, affected nodes: %d, converged: %v",
		iteration, len(affectedNodes), m.rpcServer.IsConverged())

	if !m.rpcServer.IsConverged() && m.rpcServer.GetMaxDelta() > m.rpcServer.GetConvergenceThreshold() {
		time.Sleep(100 * time.Millisecond)
		m.rpcServer.StartIncrementalIteration()
	} else {
		m.incrementalGraph.ClearChangeHistory()
		m.rpcServer.ClearIncrementalState()
		log.Printf("[Master] Incremental computation finished, affected %d nodes", len(affectedNodes))
	}
}

func (m *MasterNode) onWorkerFailed(workerID string, partitionID int32) {
	log.Printf("[Master] Worker %s failed (partition %d), attempting reassignment...",
		workerID, partitionID)

	go func() {
		time.Sleep(2 * time.Second)
		availableWorkers := m.rpcServer.GetWorkerIDs()
		if len(availableWorkers) == 0 {
			log.Printf("[Error] No available workers to reassign partition %d", partitionID)
			return
		}
		log.Printf("[Master] %d available workers for reassignment", len(availableWorkers))
	}()
}

func (m *MasterNode) loadGraph(filePath string) {
	log.Printf("[Master] Loading graph from %s...", filePath)
	var err error
	m.graphData, err = graph.LoadGraphFromFile(filePath)
	if err != nil {
		log.Printf("[Error] Failed to load graph: %v", err)
		return
	}
	log.Printf("[Master] Graph loaded: %d nodes, %d edges", m.graphData.NodeCount(), m.graphData.EdgeCount())
	if m.rpcServer.GetReadyWorkers() >= int32(*numWorkers) {
		m.distributePartitions()
	}
}

func (m *MasterNode) distributePartitions() {
	if m.graphData == nil {
		log.Printf("[Warning] No graph data to distribute")
		return
	}
	workerIDs := m.rpcServer.GetWorkerIDs()
	numPartitions := min(len(workerIDs), *numWorkers)
	if numPartitions == 0 {
		log.Printf("[Warning] No workers available")
		return
	}
	partitions := m.graphData.Partitioner(numPartitions)
	for i, workerID := range workerIDs {
		if i >= len(partitions) {
			break
		}
		p := partitions[i]
		partition := &pb.GraphPartition{
			PartitionId:    p.ID,
			TotalPartitions: p.Total,
			LocalNodes:     p.LocalNodes,
			GhostNodes:     p.GhostNodes,
		}
		for _, e := range p.Edges {
			partition.Edges = append(partition.Edges, &pb.Edge{
				From: e.From,
				To:   e.To,
			})
		}
		if err := m.rpcServer.SendPartition(workerID, partition); err != nil {
			log.Printf("[Error] Failed to send partition to %s: %v", workerID, err)
		}
		control := &pb.ControlCommand{
			Type:                 pb.ControlCommand_INIT,
			DampingFactor:        m.rpcServer.GetDampingFactor(),
			ConvergenceThreshold: m.rpcServer.GetConvergenceThreshold(),
		}
		if err := m.rpcServer.SendControl(workerID, control); err != nil {
			log.Printf("[Error] Failed to send control to %s: %v", workerID, err)
		}
	}
	log.Printf("[Master] Partitions distributed to %d workers", len(workerIDs))
}

func (m *MasterNode) Shutdown() error {
	if m.rpcServer != nil {
		m.rpcServer.Shutdown()
	}
	if m.grpcServer != nil {
		m.grpcServer.GracefulStop()
	}
	if m.discovery != nil {
		m.discovery.Close()
	}
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (m *MasterNode) AddEdge(from, to int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.graphData != nil {
		m.graphData.AddEdge(from, to)
	}
	if m.incrementalGraph != nil {
		return m.incrementalGraph.AddEdgeIncremental(from, to)
	}
	return nil
}

func (m *MasterNode) RemoveEdge(from, to int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	result := false
	if m.incrementalGraph != nil {
		result = m.incrementalGraph.RemoveEdge(from, to)
	}
	if m.graphData != nil {
		m.graphData.RemoveEdge(from, to)
	}
	return result
}

func (m *MasterNode) BatchAddEdges(edges []graph.Edge) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	added := 0
	if m.incrementalGraph != nil {
		added = m.incrementalGraph.BatchAddEdges(edges)
	}
	if m.graphData != nil {
		for _, e := range edges {
			m.graphData.AddEdge(e.From, e.To)
		}
	}
	return added
}

func (m *MasterNode) BatchRemoveEdges(edges []graph.Edge) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	removed := 0
	if m.incrementalGraph != nil {
		removed = m.incrementalGraph.BatchRemoveEdges(edges)
	}
	if m.graphData != nil {
		for _, e := range edges {
			m.graphData.RemoveEdge(e.From, e.To)
		}
	}
	return removed
}

func (m *MasterNode) GetPendingChanges() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.incrementalGraph != nil {
		return m.incrementalGraph.GetPendingChanges()
	}
	return 0
}

func (m *MasterNode) StartIncrementalComputation() (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.incrementalGraph == nil {
		return 0, fmt.Errorf("incremental graph not initialized")
	}

	pending := m.incrementalGraph.GetPendingChanges()
	if pending == 0 {
		return 0, fmt.Errorf("no pending changes")
	}

	maxProp := m.rpcServer.GetMaxPropagationLevel()
	affected := m.incrementalGraph.GetAffectedNodes(int(maxProp))
	affectedCount := affected.Count()

	if affectedCount == 0 {
		m.incrementalGraph.ClearChangeHistory()
		return 0, nil
	}

	changes := m.incrementalGraph.GetChangeHistory()
	changedEdges := make([]*pb.Edge, 0)
	for _, ch := range changes {
		if ch.Type == graph.ChangeAddEdge || ch.Type == graph.ChangeRemoveEdge {
			changedEdges = append(changedEdges, &pb.Edge{
				From: ch.From,
				To:   ch.To,
			})
		}
	}

	affectedNodesList := affected.GetNodesList()
	m.rpcServer.PrepareIncrementalUpdate(
		affectedNodesList,
		changedEdges,
		maxProp,
	)

	nodes := m.graphData.GetAllNodes()
	m.rpcServer.InitializeRanks(nodes)

	m.rpcServer.StartIncrementalIteration()

	log.Printf("[Master] Started incremental computation: %d pending changes, %d affected nodes",
		pending, affectedCount)

	return affectedCount, nil
}

func (m *MasterNode) GetIncrementalGraph() *graph.IncrementalGraph {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.incrementalGraph
}

func main() {
	master := NewMasterNode()
	if err := master.Start(); err != nil {
		log.Fatalf("[Fatal] %v", err)
	}
}
