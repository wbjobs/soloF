package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"time"

	"github.com/prometheus-tsdb-manager/pkg/readahead"
	"github.com/prometheus-tsdb-manager/pkg/tsdb"
)

type Server struct {
	router       *gin.Engine
	logger       *zap.SugaredLogger
	dataDir      string
	cacheManager *readahead.CacheManager
	server       *http.Server
}

func NewServer(dataDir string, logger *zap.SugaredLogger) *Server {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(loggerMiddleware(logger))

	s := &Server{
		router:  router,
		logger:  logger,
		dataDir: dataDir,
	}

	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	api := s.router.Group("/api/v1")
	{
		api.GET("/health", s.handleHealth)
		api.GET("/analyze", s.handleAnalyze)
		api.POST("/optimize", s.handleOptimize)
		api.GET("/blocks", s.handleGetBlocks)

		cache := api.Group("/cache")
		{
			cache.GET("/stats", s.handleCacheStats)
			cache.POST("/enable", s.handleCacheEnable)
			cache.POST("/disable", s.handleCacheDisable)
			cache.POST("/flush", s.handleCacheFlush)
			cache.GET("/patterns", s.handleCachePatterns)
			cache.GET("/blocks", s.handleCacheBlocks)
		}
	}

	s.router.Static("/", "./web/dist")
}

func (s *Server) handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().Format(time.RFC3339),
		"data_dir":  s.dataDir,
	})
}

func (s *Server) handleAnalyze(c *gin.Context) {
	analyzer := tsdb.NewIndexAnalyzer(s.dataDir, s.logger)
	report, err := analyzer.Analyze(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, report)
}

func (s *Server) handleOptimize(c *gin.Context) {
	var req struct {
		DryRun bool `json:"dry_run"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		req.DryRun = false
	}

	optimizer := tsdb.NewIndexOptimizer(s.dataDir, s.logger, req.DryRun)
	result, err := optimizer.Optimize(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (s *Server) handleGetBlocks(c *gin.Context) {
	analyzer := tsdb.NewIndexAnalyzer(s.dataDir, s.logger)
	report, err := analyzer.Analyze(context.Background())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"blocks": report.BlockDetails,
		"total":  len(report.BlockDetails),
	})
}

func (s *Server) ensureCacheManager() {
	if s.cacheManager == nil {
		config := readahead.DefaultPredictorConfig()
		s.cacheManager = readahead.NewCacheManager(s.dataDir, "", s.logger)
		s.cacheManager.Initialize(config)
	}
}

func (s *Server) handleCacheStats(c *gin.Context) {
	s.ensureCacheManager()
	stats := s.cacheManager.GetStats()
	improvement := s.cacheManager.GetPredictedLatencyImprovement()

	c.JSON(http.StatusOK, gin.H{
		"stats":             stats,
		"latency_improvement_pct": improvement,
		"target_met":        improvement >= 30,
	})
}

func (s *Server) handleCacheEnable(c *gin.Context) {
	s.ensureCacheManager()
	s.cacheManager.Enable()

	c.JSON(http.StatusOK, gin.H{
		"status":  "enabled",
		"message": "Read-ahead cache enabled successfully",
	})
}

func (s *Server) handleCacheDisable(c *gin.Context) {
	s.ensureCacheManager()
	s.cacheManager.Disable()

	c.JSON(http.StatusOK, gin.H{
		"status":  "disabled",
		"message": "Read-ahead cache disabled successfully",
	})
}

func (s *Server) handleCacheFlush(c *gin.Context) {
	s.ensureCacheManager()
	s.cacheManager.Flush()

	c.JSON(http.StatusOK, gin.H{
		"status":  "flushed",
		"message": "Cache flushed successfully",
	})
}

func (s *Server) handleCachePatterns(c *gin.Context) {
	s.ensureCacheManager()
	limit := 20
	patterns := s.cacheManager.GetHotPatterns(limit)

	c.JSON(http.StatusOK, gin.H{
		"patterns": patterns,
		"total":    len(patterns),
	})
}

func (s *Server) handleCacheBlocks(c *gin.Context) {
	s.ensureCacheManager()
	blocks := s.cacheManager.GetCachedBlocks()

	c.JSON(http.StatusOK, gin.H{
		"cached_blocks": blocks,
		"count":         len(blocks),
	})
}

func (s *Server) Run(port int) error {
	s.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: s.router,
	}

	s.logger.Infof("Server starting on port %d", port)
	return s.server.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}

func loggerMiddleware(logger *zap.SugaredLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		end := time.Now()
		latency := end.Sub(start)

		logger.Infow("Request",
			"status",   c.Writer.Status(),
			"method",   c.Request.Method,
			"path",     path,
			"query",    query,
			"ip",       c.ClientIP(),
			"latency",  latency,
			"user_agent", c.Request.UserAgent(),
		)
	}
}
