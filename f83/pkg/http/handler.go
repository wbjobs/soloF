package http

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"reliable-udp/pkg/protocol"
	"reliable-udp/pkg/storage"

	"github.com/google/uuid"
)

type Handler struct {
	storage  *storage.Storage
	sessions *map[[16]byte]*protocol.Session
	sessMu   *sync.RWMutex
	dataDir  string
}

func NewHandler(storage *storage.Storage, dataDir string, sessions *map[[16]byte]*protocol.Session, sessMu *sync.RWMutex) *Handler {
	return &Handler{
		storage:  storage,
		sessions: sessions,
		sessMu:   sessMu,
		dataDir:  dataDir,
	}
}

type UploadRequest struct {
	FileName string `json:"file_name"`
	FileSize int64  `json:"file_size"`
}

type UploadResponse struct {
	TransferID  string `json:"transfer_id"`
	SessionID   string `json:"session_id"`
	TotalChunks int    `json:"total_chunks"`
}

type FECInfo struct {
	DataBlocks   int     `json:"data_blocks"`
	ParityBlocks int     `json:"parity_blocks"`
	Redundancy   float64 `json:"redundancy_pct"`
	Recovered    uint64  `json:"recovered_blocks"`
	TotalBlocks  uint64  `json:"total_blocks"`
	LossRate     float64 `json:"loss_rate_pct"`
}

type ProgressResponse struct {
	TransferID      string  `json:"transfer_id"`
	FileName        string  `json:"file_name"`
	FileSize        int64   `json:"file_size"`
	TotalChunks     int     `json:"total_chunks"`
	CompletedChunks int     `json:"completed_chunks"`
	Progress        float64 `json:"progress"`
	Status          string  `json:"status"`
	FEC             *FECInfo `json:"fec,omitempty"`
}

func (h *Handler) UploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req UploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	transferID := uuid.New().String()
	chunkSize := 1024 * 1024
	totalChunks := int((req.FileSize + int64(chunkSize) - 1) / int64(chunkSize))

	sessionID := uuid.New()
	var sid [16]byte
	copy(sid[:], sessionID[:])

	if err := h.storage.CreateTransfer(transferID, req.FileName, req.FileSize, totalChunks, sid); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resp := UploadResponse{
		TransferID:  transferID,
		SessionID:   hex.EncodeToString(sid[:]),
		TotalChunks: totalChunks,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) ProgressHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	transferID := r.URL.Query().Get("id")
	if transferID == "" {
		http.Error(w, "Missing transfer id", http.StatusBadRequest)
		return
	}

	transfer, err := h.storage.GetTransfer(transferID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	progress := 0.0
	if transfer.TotalChunks > 0 {
		progress = float64(transfer.Completed) / float64(transfer.TotalChunks) * 100
	}

	resp := ProgressResponse{
		TransferID:      transfer.ID,
		FileName:        transfer.FileName,
		FileSize:        transfer.FileSize,
		TotalChunks:     transfer.TotalChunks,
		CompletedChunks: transfer.Completed,
		Progress:        progress,
		Status:          transfer.Status,
	}

	if transfer.SessionID != nil && h.sessions != nil {
		h.sessMu.RLock()
		sess, exists := (*h.sessions)[*transfer.SessionID]
		h.sessMu.RUnlock()

		if exists {
			recovered, total, config, lossRate := sess.GetFECStats()
			redundancy := 0.0
			if config.DataBlocks > 0 {
				redundancy = float64(config.ParityBlocks) / float64(config.DataBlocks) * 100
			}
			resp.FEC = &FECInfo{
				DataBlocks:   config.DataBlocks,
				ParityBlocks: config.ParityBlocks,
				Redundancy:   redundancy,
				Recovered:    recovered,
				TotalBlocks:  total,
				LossRate:     lossRate * 100,
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) DownloadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	transferID := r.URL.Query().Get("id")
	if transferID == "" {
		http.Error(w, "Missing transfer id", http.StatusBadRequest)
		return
	}

	transfer, err := h.storage.GetTransfer(transferID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if transfer.Status != "completed" {
		http.Error(w, "File transfer not completed", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(h.dataDir, transferID)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Disposition", "attachment; filename="+transfer.FileName)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filePath)
}

func (h *Handler) ListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	transfers, err := h.storage.ListTransfers()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(transfers)
}
