package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type GraphData struct {
	Nodes []int64    `json:"nodes"`
	Edges []EdgeData `json:"edges"`
}

type EdgeData struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

type PageRankResult struct {
	Iteration   int32            `json:"iteration"`
	Converged   bool             `json:"converged"`
	MaxDelta    float64          `json:"max_delta"`
	Ranks       map[int64]float64 `json:"ranks"`
	WorkerStatus map[string]map[string]interface{} `json:"worker_status"`
}

type ConfigRequest struct {
	DampingFactor        float64 `json:"damping_factor"`
	ConvergenceThreshold float64 `json:"convergence_threshold"`
	MaxIterations        int32   `json:"max_iterations"`
}

type StatusResponse struct {
	Status             string  `json:"status"`
	ReadyWorkers       int32   `json:"ready_workers"`
	TotalWorkers       int32   `json:"total_workers"`
	FailedWorkers      int     `json:"failed_workers"`
	PendingPartitions  int     `json:"pending_partitions"`
	Iteration          int32   `json:"iteration"`
	Converged          bool    `json:"converged"`
	MaxDelta           float64 `json:"max_delta"`
	DampingFactor      float64 `json:"damping_factor"`
	ConvergenceThreshold float64 `json:"convergence_threshold"`
	HeartbeatTimeout   int64   `json:"heartbeat_timeout_seconds"`
	ResponseTimeout    int64   `json:"response_timeout_seconds"`
}

type MasterAPI struct {
	router *gin.Engine
	server *http.Server
	graphStore *GraphStore
	pagerankEngine PageRankEngine
	masterNode interface{}
}

type GraphStore struct {
	currentGraph *GraphData
}

type PageRankEngine interface {
	GetRanks() map[int64]float64
	GetIteration() int32
	IsConverged() bool
	GetMaxDelta() float64
	GetReadyWorkers() int32
	GetWorkerCount() int
	GetWorkerIDs() []string
	GetWorkerStatus() map[string]map[string]interface{}
	GetDampingFactor() float64
	GetConvergenceThreshold() float64
	SetDampingFactor(float64)
	SetConvergenceThreshold(float64)
	StartIteration()
	InitializeRanks([]int64)
	GetFailedWorkers() map[string]interface{}
	GetPendingPartitions() map[int32]map[string]interface{}
	EnableIncrementalMode()
	DisableIncrementalMode()
	IsIncrementalMode() bool
	SetMaxPropagationLevel(int32)
	GetMaxPropagationLevel() int32
	PrepareIncrementalUpdate([]int64, []interface{}, int32)
	StartIncrementalIteration()
	GetIncrementalIteration() int32
	GetAffectedNodes() map[int64]bool
	GetIncrementalRanks() map[int64]float64
	ClearIncrementalState()
}

func NewMasterAPI(engine PageRankEngine, masterNode interface{}) *MasterAPI {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	r.Use(CORSMiddleware())

	api := &MasterAPI{
		router:       r,
		graphStore:   &GraphStore{},
		pagerankEngine: engine,
		masterNode:   masterNode,
	}
	api.registerRoutes()
	return api
}

func (api *MasterAPI) registerRoutes() {
	r := api.router
	r.GET("/api/status", api.handleStatus)
	r.POST("/api/graph", api.handleUploadGraph)
	r.GET("/api/graph", api.handleGetGraph)
	r.POST("/api/start", api.handleStart)
	r.POST("/api/stop", api.handleStop)
	r.GET("/api/result", api.handleGetResult)
	r.POST("/api/config", api.handleConfig)
	r.GET("/api/workers", api.handleWorkers)
	r.POST("/api/generate", api.handleGenerateGraph)
	r.GET("/api/health", api.handleHealth)
	r.GET("/api/failed-workers", api.handleFailedWorkers)
	r.GET("/api/pending-partitions", api.handlePendingPartitions)

	r.POST("/api/incremental/edges/add", api.handleAddEdge)
	r.POST("/api/incremental/edges/remove", api.handleRemoveEdge)
	r.POST("/api/incremental/edges/batch-add", api.handleBatchAddEdges)
	r.POST("/api/incremental/edges/batch-remove", api.handleBatchRemoveEdges)
	r.POST("/api/incremental/compute", api.handleStartIncremental)
	r.GET("/api/incremental/changes", api.handleGetPendingChanges)
	r.POST("/api/incremental/config", api.handleIncrementalConfig)
	r.GET("/api/incremental/affected", api.handleGetAffectedNodes)
	r.GET("/api/incremental/ranks", api.handleGetIncrementalRanks)
}

func (api *MasterAPI) handleStatus(c *gin.Context) {
	failedWorkers := api.pagerankEngine.GetFailedWorkers()
	pendingPartitions := api.pagerankEngine.GetPendingPartitions()

	status := StatusResponse{
		Status:               "running",
		ReadyWorkers:         api.pagerankEngine.GetReadyWorkers(),
		TotalWorkers:         int32(api.pagerankEngine.GetWorkerCount()),
		FailedWorkers:        len(failedWorkers),
		PendingPartitions:    len(pendingPartitions),
		Iteration:            api.pagerankEngine.GetIteration(),
		Converged:            api.pagerankEngine.IsConverged(),
		MaxDelta:             api.pagerankEngine.GetMaxDelta(),
		DampingFactor:        api.pagerankEngine.GetDampingFactor(),
		ConvergenceThreshold: api.pagerankEngine.GetConvergenceThreshold(),
		HeartbeatTimeout:     10,
		ResponseTimeout:      30,
	}
	c.JSON(http.StatusOK, status)
}

func (api *MasterAPI) handleUploadGraph(c *gin.Context) {
	var graphData GraphData
	if err := c.ShouldBindJSON(&graphData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid graph data: " + err.Error()})
		return
	}
	if len(graphData.Nodes) == 0 {
		nodeSet := make(map[int64]bool)
		for _, e := range graphData.Edges {
			nodeSet[e.From] = true
			nodeSet[e.To] = true
		}
		graphData.Nodes = make([]int64, 0, len(nodeSet))
		for n := range nodeSet {
			graphData.Nodes = append(graphData.Nodes, n)
		}
	}
	api.graphStore.currentGraph = &graphData
	api.pagerankEngine.InitializeRanks(graphData.Nodes)
	c.JSON(http.StatusOK, gin.H{
		"message":     "Graph uploaded successfully",
		"node_count":  len(graphData.Nodes),
		"edge_count":  len(graphData.Edges),
	})
}

func (api *MasterAPI) handleGetGraph(c *gin.Context) {
	if api.graphStore.currentGraph == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No graph loaded"})
		return
	}
	c.JSON(http.StatusOK, api.graphStore.currentGraph)
}

func (api *MasterAPI) handleStart(c *gin.Context) {
	api.pagerankEngine.StartIteration()
	c.JSON(http.StatusOK, gin.H{"message": "PageRank computation started"})
}

func (api *MasterAPI) handleStop(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "PageRank computation stopped"})
}

func (api *MasterAPI) handleGetResult(c *gin.Context) {
	result := PageRankResult{
		Iteration:   api.pagerankEngine.GetIteration(),
		Converged:   api.pagerankEngine.IsConverged(),
		MaxDelta:    api.pagerankEngine.GetMaxDelta(),
		Ranks:       api.pagerankEngine.GetRanks(),
		WorkerStatus: api.pagerankEngine.GetWorkerStatus(),
	}
	c.JSON(http.StatusOK, result)
}

func (api *MasterAPI) handleConfig(c *gin.Context) {
	var config ConfigRequest
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid config"})
		return
	}
	if config.DampingFactor > 0 {
		api.pagerankEngine.SetDampingFactor(config.DampingFactor)
	}
	if config.ConvergenceThreshold > 0 {
		api.pagerankEngine.SetConvergenceThreshold(config.ConvergenceThreshold)
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Configuration updated",
		"damping_factor": api.pagerankEngine.GetDampingFactor(),
		"convergence_threshold": api.pagerankEngine.GetConvergenceThreshold(),
	})
}

func (api *MasterAPI) handleWorkers(c *gin.Context) {
	workers := api.pagerankEngine.GetWorkerIDs()
	status := api.pagerankEngine.GetWorkerStatus()
	c.JSON(http.StatusOK, gin.H{
		"worker_count": len(workers),
		"worker_ids":   workers,
		"status":       status,
	})
}

func (api *MasterAPI) handleGenerateGraph(c *gin.Context) {
	numNodes, _ := strconv.Atoi(c.DefaultQuery("nodes", "1000"))
	numEdges, _ := strconv.Atoi(c.DefaultQuery("edges", "5000"))
	graphData := generateRandomGraph(numNodes, numEdges)
	api.graphStore.currentGraph = graphData
	api.pagerankEngine.InitializeRanks(graphData.Nodes)
	c.JSON(http.StatusOK, gin.H{
		"message":    "Random graph generated",
		"node_count": len(graphData.Nodes),
		"edge_count": len(graphData.Edges),
		"nodes":      graphData.Nodes[:min(100, len(graphData.Nodes))],
		"edges":      graphData.Edges[:min(100, len(graphData.Edges))],
	})
}

func generateRandomGraph(numNodes, numEdges int) *GraphData {
	nodes := make([]int64, numNodes)
	for i := 0; i < numNodes; i++ {
		nodes[i] = int64(i)
	}
	edges := make([]EdgeData, numEdges)
	for i := 0; i < numEdges; i++ {
		from := int64(i % numNodes)
		to := int64((i * 7 + 3) % numNodes)
		if to == from {
			to = int64((to + 1) % numNodes)
		}
		edges[i] = EdgeData{From: from, To: to}
	}
	return &GraphData{Nodes: nodes, Edges: edges}
}

func (api *MasterAPI) handleHealth(c *gin.Context) {
	failedWorkers := api.pagerankEngine.GetFailedWorkers()
	pendingPartitions := api.pagerankEngine.GetPendingPartitions()
	workerStatus := api.pagerankEngine.GetWorkerStatus()

	healthStatus := "healthy"
	if len(failedWorkers) > 0 {
		healthStatus = "degraded"
	}
	if len(pendingPartitions) > 0 {
		healthStatus = "warning"
	}

	healthyWorkers := 0
	stalledWorkers := 0
	for _, status := range workerStatus {
		state, ok := status["state"].(string)
		if ok && state == "working" {
			healthyWorkers++
		}
		respAge, ok := status["response_age_seconds"].(float64)
		if ok && respAge > 30 {
			stalledWorkers++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"status":             healthStatus,
		"healthy_workers":    healthyWorkers,
		"failed_workers":     len(failedWorkers),
		"stalled_workers":    stalledWorkers,
		"pending_partitions": len(pendingPartitions),
		"total_workers":      api.pagerankEngine.GetWorkerCount(),
		"iteration":          api.pagerankEngine.GetIteration(),
		"converged":          api.pagerankEngine.IsConverged(),
		"timestamp":          time.Now().Format(time.RFC3339),
	})
}

func (api *MasterAPI) handleFailedWorkers(c *gin.Context) {
	failedWorkers := api.pagerankEngine.GetFailedWorkers()
	c.JSON(http.StatusOK, gin.H{
		"count": len(failedWorkers),
		"workers": failedWorkers,
	})
}

func (api *MasterAPI) handlePendingPartitions(c *gin.Context) {
	partitions := api.pagerankEngine.GetPendingPartitions()
	c.JSON(http.StatusOK, gin.H{
		"count": len(partitions),
		"partitions": partitions,
	})
}

func (api *MasterAPI) handleAddEdge(c *gin.Context) {
	type EdgeRequest struct {
		From int64 `json:"from" binding:"required"`
		To   int64 `json:"to" binding:"required"`
	}

	var req EdgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type EdgeAdder interface {
		AddEdge(int64, int64) error
	}
	if adder, ok := api.masterNode.(EdgeAdder); ok {
		if err := adder.AddEdge(req.From, req.To); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Edge added successfully",
		"from":    req.From,
		"to":      req.To,
	})
}

func (api *MasterAPI) handleRemoveEdge(c *gin.Context) {
	type EdgeRequest struct {
		From int64 `json:"from" binding:"required"`
		To   int64 `json:"to" binding:"required"`
	}

	var req EdgeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type EdgeRemover interface {
		RemoveEdge(int64, int64) bool
	}
	removed := false
	if remover, ok := api.masterNode.(EdgeRemover); ok {
		removed = remover.RemoveEdge(req.From, req.To)
	}

	if !removed {
		c.JSON(http.StatusNotFound, gin.H{"error": "Edge not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Edge removed successfully",
		"from":    req.From,
		"to":      req.To,
	})
}

func (api *MasterAPI) handleBatchAddEdges(c *gin.Context) {
	type BatchRequest struct {
		Edges []graph.Edge `json:"edges" binding:"required"`
	}

	var req BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type BatchEdgeAdder interface {
		BatchAddEdges([]graph.Edge) int
	}
	added := 0
	if adder, ok := api.masterNode.(BatchEdgeAdder); ok {
		added = adder.BatchAddEdges(req.Edges)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Batch add completed",
		"added_count": added,
		"total":       len(req.Edges),
	})
}

func (api *MasterAPI) handleBatchRemoveEdges(c *gin.Context) {
	type BatchRequest struct {
		Edges []graph.Edge `json:"edges" binding:"required"`
	}

	var req BatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	type BatchEdgeRemover interface {
		BatchRemoveEdges([]graph.Edge) int
	}
	removed := 0
	if remover, ok := api.masterNode.(BatchEdgeRemover); ok {
		removed = remover.BatchRemoveEdges(req.Edges)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Batch remove completed",
		"removed_count": removed,
		"total":         len(req.Edges),
	})
}

func (api *MasterAPI) handleStartIncremental(c *gin.Context) {
	type IncrementalStarter interface {
		StartIncrementalComputation() (int, error)
	}
	if starter, ok := api.masterNode.(IncrementalStarter); ok {
		affectedCount, err := starter.StartIncrementalComputation()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":          "Incremental computation started",
			"affected_nodes":   affectedCount,
			"iteration":        api.pagerankEngine.GetIncrementalIteration(),
		})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Incremental computation not supported"})
}

func (api *MasterAPI) handleGetPendingChanges(c *gin.Context) {
	type PendingChangesGetter interface {
		GetPendingChanges() int
	}
	pending := 0
	if getter, ok := api.masterNode.(PendingChangesGetter); ok {
		pending = getter.GetPendingChanges()
	}

	affected := api.pagerankEngine.GetAffectedNodes()
	affectedList := make([]int64, 0, len(affected))
	for node := range affected {
		affectedList = append(affectedList, node)
	}

	c.JSON(http.StatusOK, gin.H{
		"pending_changes":    pending,
		"affected_nodes":     affectedList,
		"affected_count":     len(affectedList),
		"incremental_mode":   api.pagerankEngine.IsIncrementalMode(),
		"propagation_level":  api.pagerankEngine.GetMaxPropagationLevel(),
	})
}

func (api *MasterAPI) handleIncrementalConfig(c *gin.Context) {
	type ConfigRequest struct {
		MaxPropagationLevel *int32 `json:"max_propagation_level"`
		IncrementalMode     *bool  `json:"incremental_mode"`
	}

	var req ConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.MaxPropagationLevel != nil && *req.MaxPropagationLevel > 0 {
		api.pagerankEngine.SetMaxPropagationLevel(*req.MaxPropagationLevel)
	}

	if req.IncrementalMode != nil {
		if *req.IncrementalMode {
			api.pagerankEngine.EnableIncrementalMode()
		} else {
			api.pagerankEngine.DisableIncrementalMode()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":               "Incremental config updated",
		"max_propagation_level": api.pagerankEngine.GetMaxPropagationLevel(),
		"incremental_mode":      api.pagerankEngine.IsIncrementalMode(),
	})
}

func (api *MasterAPI) handleGetAffectedNodes(c *gin.Context) {
	affected := api.pagerankEngine.GetAffectedNodes()
	affectedList := make([]int64, 0, len(affected))
	for node := range affected {
		affectedList = append(affectedList, node)
	}

	c.JSON(http.StatusOK, gin.H{
		"nodes": affectedList,
		"count": len(affectedList),
	})
}

func (api *MasterAPI) handleGetIncrementalRanks(c *gin.Context) {
	ranks := api.pagerankEngine.GetIncrementalRanks()
	c.JSON(http.StatusOK, gin.H{
		"ranks":     ranks,
		"iteration": api.pagerankEngine.GetIncrementalIteration(),
	})
}

func (api *MasterAPI) Run(addr string) error {
	api.server = &http.Server{
		Addr:    addr,
		Handler: api.router,
	}
	fmt.Printf("[API] HTTP server listening on %s\n", addr)
	return api.server.ListenAndServe()
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
