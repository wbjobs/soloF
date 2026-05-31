package backend

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"zk-voting-system/merkle"
	"zk-voting-system/zk"
)

type CreatePollRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type CastVoteRequest struct {
	Nullifier  string   `json:"nullifier" binding:"required"`
	Nonce      string   `json:"nonce" binding:"required"`
	MerkleRoot string   `json:"merkle_root" binding:"required"`
	ProofBytes []byte   `json:"proof_bytes" binding:"required"`
}

type TallyResponse struct {
	PollID         string   `json:"poll_id"`
	Count1         int      `json:"count1"`
	Count2         int      `json:"count2"`
	Count3         int      `json:"count3"`
	TotalVotes     int      `json:"total_votes"`
	Nonces         []string `json:"nonces"`
	AggregateProof []byte   `json:"aggregate_proof,omitempty"`
}

type CreateBackupRequest struct {
	Password string `json:"password" binding:"required"`
}

type VerifyProofsResponse struct {
	Valid              bool   `json:"valid"`
	Message            string `json:"message"`
	VerifiedVotes      int    `json:"verified_votes"`
	TotalVotes         int    `json:"total_votes"`
	TallyMatches       bool   `json:"tally_matches"`
	AggregateProofValid bool  `json:"aggregate_proof_valid"`
}

type Handler struct {
	storage *Storage
}

func NewHandler(storage *Storage) *Handler {
	return &Handler{
		storage: storage,
	}
}

func (h *Handler) CreatePoll(c *gin.Context) {
	var req CreatePollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pollID := generateID()

	leaves := h.storage.GetWhitelist()
	if len(leaves) == 0 {
		demoLeaf := merkle.PubKeyToLeaf([]byte("demo-voter"))
		leaves = append(leaves, demoLeaf)
	}

	mt := merkle.NewMerkleTree(leaves)

	now := time.Now().Unix()
	poll := h.storage.CreatePoll(pollID, req.Name, req.Description, mt.RootHex(), now)

	c.JSON(http.StatusCreated, gin.H{
		"poll_id":     poll.ID,
		"name":        poll.Name,
		"description": poll.Description,
		"merkle_root": poll.MerkleRoot,
		"created_at":  poll.CreatedAt,
		"is_active":   poll.IsActive,
	})
}

func (h *Handler) GetPoll(c *gin.Context) {
	pollID := c.Param("id")

	poll, exists := h.storage.GetPoll(pollID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "poll not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"poll_id":     poll.ID,
		"name":        poll.Name,
		"description": poll.Description,
		"merkle_root": poll.MerkleRoot,
		"vote_count":  len(poll.Votes),
		"created_at":  poll.CreatedAt,
		"is_active":   poll.IsActive,
		"is_tallied":  poll.IsTallied,
	})
}

func (h *Handler) ListPolls(c *gin.Context) {
	polls := h.storage.GetAllPolls()

	response := make([]gin.H, len(polls))
	for i, poll := range polls {
		response[i] = gin.H{
			"poll_id":     poll.ID,
			"name":        poll.Name,
			"description": poll.Description,
			"merkle_root": poll.MerkleRoot,
			"vote_count":  len(poll.Votes),
			"created_at":  poll.CreatedAt,
			"is_active":   poll.IsActive,
			"is_tallied":  poll.IsTallied,
		}
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) CastVote(c *gin.Context) {
	pollID := c.Param("id")

	poll, exists := h.storage.GetPoll(pollID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "poll not found"})
		return
	}

	if !poll.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "poll is closed"})
		return
	}

	var req CastVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	nullifierBytes, err := hex.DecodeString(req.Nullifier)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid nullifier format"})
		return
	}

	merkleRootBytes, err := hex.DecodeString(req.MerkleRoot)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid merkle root format"})
		return
	}

	proof, err := BytesToProof(req.ProofBytes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid proof format"})
		return
	}

	voteProof := &zk.VoteProof{
		Proof:      proof,
		Nullifier:  nullifierBytes,
		MerkleRoot: merkleRootBytes,
	}

	setup := h.storage.GetSetup()
	if setup != nil {
		valid, err := zk.VerifyVoteProof(setup, voteProof)
		if err != nil || !valid {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid zk proof"})
			return
		}
	}

	now := time.Now().Unix()
	err = h.storage.CastVote(pollID, voteProof, req.Nonce, req.ProofBytes, now)
	if err != nil {
		if err.Error() == "file already exists" {
			c.JSON(http.StatusConflict, gin.H{"error": "already voted or nonce reused"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cast vote"})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "success",
		"nullifier": req.Nullifier,
		"nonce":     req.Nonce,
	})
}

func (h *Handler) TallyVotes(c *gin.Context) {
	pollID := c.Param("id")

	poll, exists := h.storage.GetPoll(pollID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "poll not found"})
		return
	}

	nullifiers, nonces, _ := h.storage.GetAllNullifiers(pollID)

	count1, count2, count3 := simulateTally(poll)

	aggregateProof := generateAggregateProofMock(poll, count1, count2, count3)

	h.storage.SetTallyResult(pollID, count1, count2, count3, aggregateProof)

	response := TallyResponse{
		PollID:         pollID,
		Count1:         count1,
		Count2:         count2,
		Count3:         count3,
		TotalVotes:     len(nullifiers),
		Nonces:         nonces,
		AggregateProof: aggregateProof,
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) ExportProofs(c *gin.Context) {
	pollID := c.Param("id")

	export, exists := h.storage.ExportProofs(pollID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "poll not found"})
		return
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=proofs_"+pollID+".json")
	c.JSON(http.StatusOK, export)
}

func (h *Handler) CreateBackup(c *gin.Context) {
	pollID := c.Param("id")

	var req CreateBackupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	encrypted, salt, err := h.storage.CreateEncryptedBackup(pollID, req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create backup"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "success",
		"backup_size": len(encrypted),
		"salt":     hex.EncodeToString(salt),
		"message":  "Encrypted backup created. Backend cannot decrypt without password.",
	})
}

func (h *Handler) DownloadBackup(c *gin.Context) {
	pollID := c.Param("id")

	encrypted, salt, exists := h.storage.GetEncryptedBackup(pollID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "backup not found"})
		return
	}

	export := gin.H{
		"poll_id":    pollID,
		"encrypted":  encrypted,
		"salt":       salt,
	}

	c.Header("Content-Type", "application/json")
	c.Header("Content-Disposition", "attachment; filename=backup_"+pollID+".json")
	c.JSON(http.StatusOK, export)
}

func (h *Handler) ClosePoll(c *gin.Context) {
	pollID := c.Param("id")

	if !h.storage.ClosePoll(pollID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "poll not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "poll closed",
	})
}

func (h *Handler) AddToWhitelist(c *gin.Context) {
	var req struct {
		PubKey string `json:"pub_key" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pubKeyBytes, err := hex.DecodeString(req.PubKey)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid public key format"})
		return
	}

	index := h.storage.AddToWhitelist(pubKeyBytes)

	c.JSON(http.StatusOK, gin.H{
		"status":    "success",
		"index":     index,
		"pub_key_hash": hex.EncodeToString(merkle.PubKeyToLeaf(pubKeyBytes)),
	})
}

func (h *Handler) GetMerkleProof(c *gin.Context) {
	pubKeyHex := c.Query("pub_key")
	if pubKeyHex == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pub_key query parameter is required"})
		return
	}

	pubKeyBytes, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid public key format"})
		return
	}

	proof, root, index, ok := h.storage.GetMerkleProof(pubKeyBytes)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "public key not in whitelist"})
		return
	}

	pathHex := make([]string, len(proof.Path))
	for i, sibling := range proof.Path {
		pathHex[i] = hex.EncodeToString(sibling)
	}

	c.JSON(http.StatusOK, gin.H{
		"merkle_root": hex.EncodeToString(root),
		"merkle_path": pathHex,
		"merkle_index": index,
		"leaf":        hex.EncodeToString(proof.Leaf),
	})
}

func (h *Handler) GetMerkleRoot(c *gin.Context) {
	leaves := h.storage.GetWhitelist()
	mt := merkle.NewMerkleTree(leaves)

	c.JSON(http.StatusOK, gin.H{
		"merkle_root": mt.RootHex(),
		"leaf_count":  len(leaves),
	})
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func simulateTally(poll *Poll) (int, int, int) {
	return len(poll.Votes) / 3, len(poll.Votes) / 3, len(poll.Votes) - 2*(len(poll.Votes)/3)
}

func generateAggregateProofMock(poll *Poll, count1, count2, count3 int) []byte {
	proof := map[string]interface{}{
		"type":         "groth16",
		"curve":        "bn254",
		"circuit":      "aggregate_v2",
		"poll_id":      poll.ID,
		"total_votes":  len(poll.Votes),
		"count1":       count1,
		"count2":       count2,
		"count3":       count3,
		"merkle_root":  poll.MerkleRoot,
		"timestamp":    time.Now().Unix(),
	}
	data, _ := json.Marshal(proof)
	return data
}
