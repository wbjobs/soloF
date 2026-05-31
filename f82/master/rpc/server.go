package rpc

import (
	"context"
	"fmt"
	"sync"
	"time"

	pb "f82/proto/pagerank"
)

const (
	HeartbeatTimeout  = 10 * time.Second
	ResponseTimeout   = 30 * time.Second
	CheckInterval     = 5 * time.Second
	MaxRetryAttempts  = 3
)

type WorkerState int

const (
	WorkerIdle WorkerState = iota
	WorkerWorking
	WorkerFailed
)

type MasterServer struct {
	pb.UnimplementedPageRankServiceServer
	mu sync.RWMutex
	workers map[string]*workerSession
	ranks map[int64]float64
	iteration int32
	dampingFactor float64
	convergenceThreshold float64
	converged bool
	readyWorkers int32
	totalWorkers int32
	onWorkerReady func()
	onIterationComplete func(int32, map[int64]float64)
	onConverged func(map[int64]float64)
	onWorkerFailed func(string, int32)
	onIncrementalComplete func(int32, map[int64]float64, []int64)
	pendingPartitions map[int32]*pendingPartition
	partitionMap map[int32]string
	failedWorkers map[string]time.Time
	healthCheckCtx context.Context
	healthCheckCancel context.CancelFunc
	isRunning bool
	incrementalMode bool
	maxPropagationLevel int32
	affectedNodes map[int64]bool
	incrementalIteration int32
	incrementalUpdate *pb.IncrementalUpdate
	incrementalResponses map[string]bool
	incrementalRanks map[int64]float64
}

type workerSession struct {
	stream pb.PageRankService_ComputeServer
	workerID string
	partitionID int32
	lastMaxDelta float64
	converged bool
	ctx context.Context
	cancel context.CancelFunc
	lastHeartbeat time.Time
	lastResponse time.Time
	responseReceived bool
	state WorkerState
	currentIteration int32
}

type pendingPartition struct {
	partitionID int32
	partitionData *pb.GraphPartition
	retryCount int
	lastAssigned time.Time
	assignedWorker string
}

func NewMasterServer(totalWorkers int32) *MasterServer {
	ctx, cancel := context.WithCancel(context.Background())
	ms := &MasterServer{
		workers: make(map[string]*workerSession),
		ranks: make(map[int64]float64),
		dampingFactor: 0.85,
		convergenceThreshold: 0.0001,
		totalWorkers: totalWorkers,
		pendingPartitions: make(map[int32]*pendingPartition),
		partitionMap: make(map[int32]string),
		failedWorkers: make(map[string]time.Time),
		healthCheckCtx: ctx,
		healthCheckCancel: cancel,
		isRunning: true,
		incrementalMode: false,
		maxPropagationLevel: 3,
		affectedNodes: make(map[int64]bool),
		incrementalIteration: 0,
		incrementalResponses: make(map[string]bool),
		incrementalRanks: make(map[int64]float64),
	}
	go ms.healthCheckLoop()
	return ms
}

func (s *MasterServer) SetCallbacks(
	onWorkerReady func(),
	onIterationComplete func(int32, map[int64]float64),
	onConverged func(map[int64]float64),
) {
	s.onWorkerReady = onWorkerReady
	s.onIterationComplete = onIterationComplete
	s.onConverged = onConverged
}

func (s *MasterServer) SetOnWorkerFailed(callback func(string, int32)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onWorkerFailed = callback
}

func (s *MasterServer) SetOnIncrementalComplete(callback func(int32, map[int64]float64, []int64)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onIncrementalComplete = callback
}

func (s *MasterServer) EnableIncrementalMode() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.incrementalMode = true
}

func (s *MasterServer) DisableIncrementalMode() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.incrementalMode = false
}

func (s *MasterServer) IsIncrementalMode() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.incrementalMode
}

func (s *MasterServer) SetMaxPropagationLevel(level int32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if level > 0 {
		s.maxPropagationLevel = level
	}
}

func (s *MasterServer) GetMaxPropagationLevel() int32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.maxPropagationLevel
}

func (s *MasterServer) healthCheckLoop() {
	ticker := time.NewTicker(CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.healthCheckCtx.Done():
			return
		case <-ticker.C:
			s.checkWorkerHealth()
		}
	}
}

func (s *MasterServer) checkWorkerHealth() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	failedWorkers := make([]string, 0)

	for workerID, session := range s.workers {
		if session.state == WorkerWorking {
			responseDeadline := session.lastResponse.Add(ResponseTimeout)
			if now.After(responseDeadline) && !session.responseReceived {
				fmt.Printf("[Master] Worker %s response timeout (last: %v)\n",
					workerID, session.lastResponse.Format("15:04:05"))
				failedWorkers = append(failedWorkers, workerID)
				continue
			}
		}

		heartbeatDeadline := session.lastHeartbeat.Add(HeartbeatTimeout)
		if now.After(heartbeatDeadline) {
			fmt.Printf("[Master] Worker %s heartbeat timeout (last: %v)\n",
				workerID, session.lastHeartbeat.Format("15:04:05"))
			failedWorkers = append(failedWorkers, workerID)
		}
	}

	for _, workerID := range failedWorkers {
		s.handleWorkerFailureLocked(workerID)
	}

	s.checkAndRedistributePendingPartitionsLocked()
}

func (s *MasterServer) handleWorkerFailureLocked(workerID string) {
	session, exists := s.workers[workerID]
	if !exists {
		return
	}

	fmt.Printf("[Master] Handling failure of worker %s (partition %d)\n",
		workerID, session.partitionID)

	failedPartitionID := session.partitionID

	if pending, ok := s.pendingPartitions[failedPartitionID]; ok {
		pending.retryCount++
		pending.lastAssigned = time.Now()
		pending.assignedWorker = ""
	} else if failedPartitionID >= 0 {
		fmt.Printf("[Master] Warning: Partition %d not in pending queue\n", failedPartitionID)
	}

	delete(s.workers, workerID)
	s.readyWorkers--
	s.failedWorkers[workerID] = time.Now()

	if session.cancel != nil {
		session.cancel()
	}

	if s.onWorkerFailed != nil {
		go s.onWorkerFailed(workerID, failedPartitionID)
	}
}

func (s *MasterServer) checkAndRedistributePendingPartitionsLocked() {
	if len(s.pendingPartitions) == 0 {
		return
	}

	availableWorkers := make([]*workerSession, 0)
	for _, session := range s.workers {
		if session.state == WorkerIdle || session.state == WorkerWorking {
			availableWorkers = append(availableWorkers, session)
		}
	}

	if len(availableWorkers) == 0 {
		return
	}

	for partitionID, pending := range s.pendingPartitions {
		if pending.assignedWorker != "" && pending.assignedWorker != "failed" {
			continue
		}

		if pending.retryCount >= MaxRetryAttempts {
			fmt.Printf("[Master] Partition %d exceeded max retry attempts (%d)\n",
				partitionID, MaxRetryAttempts)
			continue
		}

		targetWorker := availableWorkers[int(partitionID)%len(availableWorkers)]
		s.assignPartitionToWorkerLocked(pending.partitionData, targetWorker)
		pending.assignedWorker = targetWorker.workerID
		pending.lastAssigned = time.Now()

		fmt.Printf("[Master] Reassigned partition %d to worker %s (retry %d)\n",
			partitionID, targetWorker.workerID, pending.retryCount)
	}
}

func (s *MasterServer) assignPartitionToWorkerLocked(partition *pb.GraphPartition, session *workerSession) {
	session.partitionID = partition.PartitionId
	session.state = WorkerWorking
	session.responseReceived = false
	session.lastResponse = time.Now()
	s.partitionMap[partition.PartitionId] = session.workerID

	req := &pb.ComputeRequest{
		Msg: &pb.ComputeRequest_Partition{
			Partition: partition,
		},
	}

	if err := session.stream.Send(req); err != nil {
		fmt.Printf("[Master] Error sending partition to %s: %v\n", session.workerID, err)
		session.state = WorkerFailed
	}

	control := &pb.ControlCommand{
		Type:                 pb.ControlCommand_INIT,
		DampingFactor:        s.dampingFactor,
		ConvergenceThreshold: s.convergenceThreshold,
	}
	controlReq := &pb.ComputeRequest{
		Msg: &pb.ComputeRequest_Control{
			Control: control,
		},
	}
	session.stream.Send(controlReq)
}

func (s *MasterServer) Compute(stream pb.PageRankService_ComputeServer) error {
	workerID := generateWorkerID()
	ctx, cancel := context.WithCancel(stream.Context())
	now := time.Now()

	session := &workerSession{
		stream:         stream,
		workerID:       workerID,
		partitionID:    -1,
		ctx:            ctx,
		cancel:         cancel,
		lastHeartbeat:  now,
		lastResponse:   now,
		responseReceived: true,
		state:          WorkerIdle,
	}

	s.mu.Lock()
	s.workers[workerID] = session
	s.readyWorkers++
	readyCount := s.readyWorkers
	s.mu.Unlock()

	fmt.Printf("[Master] Worker %s connected (ready: %d/%d)\n", workerID, readyCount, s.totalWorkers)

	defer func() {
		s.mu.Lock()
		s.handleWorkerFailureLocked(workerID)
		s.mu.Unlock()
		cancel()
		fmt.Printf("[Master] Worker %s disconnected\n", workerID)
	}()

	if s.onWorkerReady != nil && readyCount >= s.totalWorkers {
		go s.onWorkerReady()
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		req, err := stream.Recv()
		if err != nil {
			return err
		}

		s.mu.Lock()
		session.lastHeartbeat = time.Now()
		s.mu.Unlock()

		s.handleRequest(session, req)
	}
}

func (s *MasterServer) handleRequest(session *workerSession, req *pb.ComputeRequest) {
	switch msg := req.Msg.(type) {
	case *pb.ComputeRequest_Partition:
		s.mu.Lock()
		session.partitionID = msg.Partition.PartitionId
		s.mu.Unlock()
		fmt.Printf("[Master] Worker %s received partition %d\n", session.workerID, msg.Partition.PartitionId)

	case *pb.ComputeRequest_GlobalRanks:
		s.mu.Lock()
		session.lastMaxDelta = 0
		session.converged = false
		s.mu.Unlock()

	case *pb.ComputeRequest_IncrementalUpdate:
		s.mu.Lock()
		session.lastMaxDelta = 0
		session.converged = false
		s.mu.Unlock()

	case *pb.ComputeRequest_Control:
		switch msg.Control.Type {
		case pb.ControlCommand_START_ITERATION:
			go s.broadcastGlobalRanks()
		case pb.ControlCommand_START_INCREMENTAL:
			go s.broadcastIncrementalUpdate()
		}
	}
}

func (s *MasterServer) SendPartition(workerID string, partition *pb.GraphPartition) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.workers[workerID]
	if !exists {
		return fmt.Errorf("worker %s not found", workerID)
	}

	s.pendingPartitions[partition.PartitionId] = &pendingPartition{
		partitionID:   partition.PartitionId,
		partitionData: partition,
		retryCount:    0,
		lastAssigned:  time.Now(),
		assignedWorker: workerID,
	}

	s.assignPartitionToWorkerLocked(partition, session)
	return nil
}

func (s *MasterServer) SendControl(workerID string, cmd *pb.ControlCommand) error {
	s.mu.RLock()
	session, exists := s.workers[workerID]
	s.mu.RUnlock()

	if !exists {
		return fmt.Errorf("worker %s not found", workerID)
	}

	req := &pb.ComputeRequest{
		Msg: &pb.ComputeRequest_Control{
			Control: cmd,
		},
	}
	return session.stream.Send(req)
}

func (s *MasterServer) InitializeRanks(nodes []int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	n := float64(len(nodes))
	for _, node := range nodes {
		s.ranks[node] = 1.0 / n
	}
	s.iteration = 0
	s.converged = false
}

func (s *MasterServer) broadcastGlobalRanks() {
	s.mu.RLock()
	ranks := make(map[int64]float64)
	for k, v := range s.ranks {
		ranks[k] = v
	}
	iter := s.iteration

	workers := make([]*workerSession, 0, len(s.workers))
	for _, w := range s.workers {
		if w.state == WorkerWorking {
			w.responseReceived = false
			w.lastResponse = time.Now()
			w.currentIteration = iter
		}
		workers = append(workers, w)
	}
	s.mu.RUnlock()

	globalRanks := &pb.GlobalRanks{
		Iteration: iter,
		Ranks: ranks,
	}
	req := &pb.ComputeRequest{
		Msg: &pb.ComputeRequest_GlobalRanks{
			GlobalRanks: globalRanks,
		},
	}

	for _, w := range workers {
		if err := w.stream.Send(req); err != nil {
			fmt.Printf("[Master] Error sending global ranks to %s: %v\n", w.workerID, err)
		}
	}
}

func (s *MasterServer) broadcastIncrementalUpdate() {
	s.mu.RLock()

	if s.incrementalUpdate == nil {
		s.mu.RUnlock()
		return
	}

	workers := make([]*workerSession, 0, len(s.workers))
	for _, w := range s.workers {
		if w.state == WorkerWorking {
			w.responseReceived = false
			w.lastResponse = time.Now()
		}
		workers = append(workers, w)
	}

	update := s.incrementalUpdate
	s.mu.RUnlock()

	req := &pb.ComputeRequest{
		Msg: &pb.ComputeRequest_IncrementalUpdate{
			IncrementalUpdate: update,
		},
	}

	for _, w := range workers {
		if err := w.stream.Send(req); err != nil {
			fmt.Printf("[Master] Error sending incremental update to %s: %v\n", w.workerID, err)
		}
	}

	fmt.Printf("[Master] Broadcasted incremental update to %d workers (affected nodes: %d)\n",
		len(workers), len(update.AffectedNodes))
}

func (s *MasterServer) PrepareIncrementalUpdate(
	affectedNodes []int64,
	changedEdges []*pb.Edge,
	maxPropagation int32,
) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.incrementalIteration++
	s.incrementalResponses = make(map[string]bool)
	s.incrementalRanks = make(map[int64]float64)
	s.affectedNodes = make(map[int64]bool)

	for _, node := range affectedNodes {
		s.affectedNodes[node] = true
	}

	initialRanks := make(map[int64]float64)
	for _, node := range affectedNodes {
		if rank, ok := s.ranks[node]; ok {
			initialRanks[node] = rank
		} else {
			initialRanks[node] = 1.0 / float64(len(s.ranks)+1)
		}
	}

	s.incrementalUpdate = &pb.IncrementalUpdate{
		Iteration:            s.incrementalIteration,
		AffectedNodes:        affectedNodes,
		ChangedEdges:         changedEdges,
		InitialRanks:         initialRanks,
		MaxPropagationLevel:  maxPropagation,
		IsIncremental:        true,
	}

	fmt.Printf("[Master] Prepared incremental update: %d affected nodes, %d changed edges, propagation level %d\n",
		len(affectedNodes), len(changedEdges), maxPropagation)
}

func (s *MasterServer) StartIncrementalIteration() {
	s.mu.Lock()
	if s.incrementalUpdate == nil {
		s.mu.Unlock()
		return
	}

	for _, w := range s.workers {
		w.converged = false
		w.responseReceived = false
		w.lastResponse = time.Now()
	}
	s.mu.Unlock()

	s.broadcastIncrementalUpdate()
}

func (s *MasterServer) HandleWorkerResponse(resp *pb.ComputeResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()

	session, exists := s.workers[resp.WorkerId]
	if !exists {
		fmt.Printf("[Master] Received response from unknown worker: %s\n", resp.WorkerId)
		return
	}

	session.lastHeartbeat = time.Now()
	session.lastResponse = time.Now()
	session.responseReceived = true

	if resp.IsIncremental {
		s.handleIncrementalResponseLocked(session, resp)
		return
	}

	if len(resp.LocalRanks) > 0 {
		for node, rank := range resp.LocalRanks {
			s.ranks[node] = rank
		}
	}

	session.lastMaxDelta = resp.LocalMaxDelta
	session.converged = resp.Converged

	fmt.Printf("[Master] Worker %s completed iteration %d (delta: %.6f, converged: %v)\n",
		resp.WorkerId, resp.Iteration, resp.LocalMaxDelta, resp.Converged)

	allResponded := true
	allConverged := true
	maxDelta := 0.0
	activeWorkerCount := 0

	for _, w := range s.workers {
		if w.state != WorkerWorking || w.partitionID < 0 {
			continue
		}
		activeWorkerCount++
		if !w.responseReceived {
			allResponded = false
		}
		if w.lastMaxDelta > maxDelta {
			maxDelta = w.lastMaxDelta
		}
		if !w.converged {
			allConverged = false
		}
	}

	if !allResponded {
		return
	}

	if allConverged && activeWorkerCount > 0 {
		s.converged = true
		ranks := make(map[int64]float64)
		for k, v := range s.ranks {
			ranks[k] = v
		}
		fmt.Printf("[Master] PageRank converged! Iteration: %d, Max delta: %.6f\n",
			s.iteration, maxDelta)
		if s.onConverged != nil {
			go s.onConverged(ranks)
		}
	} else {
		ranks := make(map[int64]float64)
		for k, v := range s.ranks {
			ranks[k] = v
		}
		iter := s.iteration
		if s.onIterationComplete != nil {
			go s.onIterationComplete(iter, ranks)
		}
	}
}

func (s *MasterServer) handleIncrementalResponseLocked(
	session *workerSession,
	resp *pb.ComputeResponse,
) {
	session.lastMaxDelta = resp.LocalMaxDelta
	session.converged = resp.Converged

	for node, rank := range resp.LocalRanks {
		s.ranks[node] = rank
		s.incrementalRanks[node] = rank
	}

	s.incrementalResponses[session.workerID] = true

	fmt.Printf("[Master] Worker %s completed incremental iteration %d (affected: %d, delta: %.6f)\n",
		resp.WorkerId, resp.Iteration, resp.AffectedCount, resp.LocalMaxDelta)

	allResponded := true
	allConverged := true
	maxDelta := 0.0
	activeWorkerCount := 0

	for _, w := range s.workers {
		if w.state != WorkerWorking || w.partitionID < 0 {
			continue
		}
		activeWorkerCount++
		if !s.incrementalResponses[w.workerID] {
			allResponded = false
		}
		if w.lastMaxDelta > maxDelta {
			maxDelta = w.lastMaxDelta
		}
		if !w.converged {
			allConverged = false
		}
	}

	if !allResponded {
		return
	}

	affectedNodesList := make([]int64, 0, len(s.affectedNodes))
	for node := range s.affectedNodes {
		affectedNodesList = append(affectedNodesList, node)
	}

	if allConverged && activeWorkerCount > 0 {
		ranks := make(map[int64]float64)
		for k, v := range s.incrementalRanks {
			ranks[k] = v
		}

		fmt.Printf("[Master] Incremental PageRank converged! Iteration: %d, Affected nodes: %d, Max delta: %.6f\n",
			s.incrementalIteration, len(affectedNodesList), maxDelta)

		if s.onIncrementalComplete != nil {
			go s.onIncrementalComplete(s.incrementalIteration, ranks, affectedNodesList)
		}
	} else {
		ranks := make(map[int64]float64)
		for k, v := range s.incrementalRanks {
			ranks[k] = v
		}
		iter := s.incrementalIteration
		if s.onIncrementalComplete != nil {
			go s.onIncrementalComplete(iter, ranks, affectedNodesList)
		}

		if maxDelta > s.convergenceThreshold {
			go s.broadcastIncrementalUpdate()
		}
	}
}

func (s *MasterServer) GetIncrementalIteration() int32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.incrementalIteration
}

func (s *MasterServer) GetAffectedNodes() map[int64]bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[int64]bool)
	for k, v := range s.affectedNodes {
		result[k] = v
	}
	return result
}

func (s *MasterServer) GetIncrementalRanks() map[int64]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[int64]float64)
	for k, v := range s.incrementalRanks {
		result[k] = v
	}
	return result
}

func (s *MasterServer) ClearIncrementalState() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.incrementalUpdate = nil
	s.incrementalResponses = make(map[string]bool)
	s.incrementalRanks = make(map[int64]float64)
	s.affectedNodes = make(map[int64]bool)
}

func (s *MasterServer) StartIteration() {
	s.mu.Lock()
	s.iteration++
	for _, w := range s.workers {
		w.converged = false
		w.responseReceived = false
		w.lastResponse = time.Now()
	}
	s.mu.Unlock()

	s.broadcastGlobalRanks()
}

func (s *MasterServer) GetRanks() map[int64]float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ranks := make(map[int64]float64)
	for k, v := range s.ranks {
		ranks[k] = v
	}
	return ranks
}

func (s *MasterServer) GetIteration() int32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.iteration
}

func (s *MasterServer) IsConverged() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.converged
}

func (s *MasterServer) GetReadyWorkers() int32 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readyWorkers
}

func (s *MasterServer) GetWorkerCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.workers)
}

func (s *MasterServer) GetWorkerIDs() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.workers))
	for id := range s.workers {
		ids = append(ids, id)
	}
	return ids
}

func (s *MasterServer) SetDampingFactor(df float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if df > 0 && df < 1 {
		s.dampingFactor = df
	}
}

func (s *MasterServer) SetConvergenceThreshold(ct float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if ct > 0 {
		s.convergenceThreshold = ct
	}
}

func (s *MasterServer) GetDampingFactor() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dampingFactor
}

func (s *MasterServer) GetConvergenceThreshold() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.convergenceThreshold
}

func (s *MasterServer) GetMaxDelta() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()

	maxDelta := 0.0
	for _, w := range s.workers {
		if w.lastMaxDelta > maxDelta {
			maxDelta = w.lastMaxDelta
		}
	}
	return maxDelta
}

func (s *MasterServer) GetWorkerStatus() map[string]map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := make(map[string]map[string]interface{})
	for id, w := range s.workers {
		stateStr := "idle"
		switch w.state {
		case WorkerWorking:
			stateStr = "working"
		case WorkerFailed:
			stateStr = "failed"
		}

		now := time.Now()
		status[id] = map[string]interface{}{
			"partition_id":   w.partitionID,
			"max_delta":      w.lastMaxDelta,
			"converged":      w.converged,
			"state":          stateStr,
			"last_heartbeat": w.lastHeartbeat.Format(time.RFC3339),
			"last_response":  w.lastResponse.Format(time.RFC3339),
			"response_received": w.responseReceived,
			"current_iteration": w.currentIteration,
			"heartbeat_age_seconds": now.Sub(w.lastHeartbeat).Seconds(),
			"response_age_seconds": now.Sub(w.lastResponse).Seconds(),
		}
	}

	for id, failTime := range s.failedWorkers {
		status[id] = map[string]interface{}{
			"state":    "failed",
			"failed_at": failTime.Format(time.RFC3339),
		}
	}

	return status
}

func (s *MasterServer) GetFailedWorkers() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]interface{})
	for k, v := range s.failedWorkers {
		result[k] = map[string]interface{}{
			"failed_at": v.Format(time.RFC3339),
			"time_ago":  time.Since(v).String(),
		}
	}
	return result
}

func (s *MasterServer) GetPendingPartitions() map[int32]map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[int32]map[string]interface{})
	for id, p := range s.pendingPartitions {
		result[id] = map[string]interface{}{
			"partition_id":     p.partitionID,
			"retry_count":      p.retryCount,
			"assigned_worker":  p.assignedWorker,
			"last_assigned":    p.lastAssigned.Format(time.RFC3339),
		}
	}
	return result
}

func (s *MasterServer) Shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.isRunning = false
	if s.healthCheckCancel != nil {
		s.healthCheckCancel()
	}

	for _, session := range s.workers {
		if session.cancel != nil {
			session.cancel()
		}
	}
}

func generateWorkerID() string {
	return fmt.Sprintf("worker-%d", time.Now().UnixNano())
}
