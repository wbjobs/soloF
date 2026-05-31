package storage

import (
	"database/sql"
	"encoding/hex"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type FileTransfer struct {
	ID          string
	FileName    string
	FileSize    int64
	TotalChunks int
	Completed   int
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	SessionID   *[16]byte
}

type ChunkState struct {
	TransferID string
	ChunkIndex int
	Status     string
	Data       []byte
	Size       int
	UpdatedAt  time.Time
}

type Storage struct {
	db *sql.DB
}

func NewStorage(dbPath string) (*Storage, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	if err := initTables(db); err != nil {
		return nil, err
	}

	return &Storage{db: db}, nil
}

func initTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS transfers (
		id TEXT PRIMARY KEY,
		file_name TEXT NOT NULL,
		file_size INTEGER NOT NULL,
		total_chunks INTEGER NOT NULL,
		completed_chunks INTEGER DEFAULT 0,
		status TEXT DEFAULT 'pending',
		session_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS chunks (
		transfer_id TEXT,
		chunk_index INTEGER,
		status TEXT DEFAULT 'pending',
		data BLOB,
		size INTEGER DEFAULT 0,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (transfer_id, chunk_index),
		FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_transfers_session ON transfers(session_id);
	CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
	`

	_, err := db.Exec(schema)
	return err
}

func (s *Storage) CreateTransfer(id, fileName string, fileSize int64, totalChunks int, sessionID [16]byte) error {
	sidStr := hex.EncodeToString(sessionID[:])
	_, err := s.db.Exec(`
		INSERT INTO transfers (id, file_name, file_size, total_chunks, session_id, status)
		VALUES (?, ?, ?, ?, ?, 'uploading')
	`, id, fileName, fileSize, totalChunks, sidStr)
	return err
}

func (s *Storage) UpdateChunk(transferID string, chunkIndex int, data []byte) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT OR REPLACE INTO chunks (transfer_id, chunk_index, status, data, size, updated_at)
		VALUES (?, ?, 'completed', ?, ?, CURRENT_TIMESTAMP)
	`, transferID, chunkIndex, data, len(data))
	if err != nil {
		return err
	}

	_, err = tx.Exec(`
		UPDATE transfers 
		SET completed_chunks = (
			SELECT COUNT(*) FROM chunks WHERE transfer_id = ? AND status = 'completed'
		),
		updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, transferID, transferID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Storage) GetChunk(transferID string, chunkIndex int) (*ChunkState, error) {
	row := s.db.QueryRow(`
		SELECT transfer_id, chunk_index, status, data, size, updated_at
		FROM chunks WHERE transfer_id = ? AND chunk_index = ?
	`, transferID, chunkIndex)

	chunk := &ChunkState{}
	var updatedAt string
	err := row.Scan(&chunk.TransferID, &chunk.ChunkIndex, &chunk.Status, &chunk.Data, &chunk.Size, &updatedAt)
	if err != nil {
		return nil, err
	}
	chunk.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
	return chunk, nil
}

func (s *Storage) GetTransfer(id string) (*FileTransfer, error) {
	row := s.db.QueryRow(`
		SELECT id, file_name, file_size, total_chunks, completed_chunks, status, session_id, created_at, updated_at
		FROM transfers WHERE id = ?
	`, id)

	ft := &FileTransfer{}
	var createdAt, updatedAt string
	var sessionStr sql.NullString
	err := row.Scan(&ft.ID, &ft.FileName, &ft.FileSize, &ft.TotalChunks, &ft.Completed, &ft.Status, &sessionStr, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	ft.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
	ft.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
	
	if sessionStr.Valid && sessionStr.String != "" {
		sidBytes, err := hex.DecodeString(sessionStr.String)
		if err == nil && len(sidBytes) == 16 {
			var sid [16]byte
			copy(sid[:], sidBytes)
			ft.SessionID = &sid
		}
	}
	
	return ft, nil
}

func (s *Storage) GetTransferBySession(sessionID [16]byte) (*FileTransfer, error) {
	sidStr := hex.EncodeToString(sessionID[:])
	row := s.db.QueryRow(`
		SELECT id, file_name, file_size, total_chunks, completed_chunks, status, session_id, created_at, updated_at
		FROM transfers WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
	`, sidStr)

	ft := &FileTransfer{}
	var createdAt, updatedAt string
	var sessionStr sql.NullString
	err := row.Scan(&ft.ID, &ft.FileName, &ft.FileSize, &ft.TotalChunks, &ft.Completed, &ft.Status, &sessionStr, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	ft.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
	ft.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
	
	if sessionStr.Valid && sessionStr.String != "" {
		sidBytes, err := hex.DecodeString(sessionStr.String)
		if err == nil && len(sidBytes) == 16 {
			var sid [16]byte
			copy(sid[:], sidBytes)
			ft.SessionID = &sid
		}
	}
	
	return ft, nil
}

func (s *Storage) MarkTransferComplete(id string) error {
	_, err := s.db.Exec(`
		UPDATE transfers SET status = 'completed', updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, id)
	return err
}

func (s *Storage) ListTransfers() ([]*FileTransfer, error) {
	rows, err := s.db.Query(`
		SELECT id, file_name, file_size, total_chunks, completed_chunks, status, session_id, created_at, updated_at
		FROM transfers ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []*FileTransfer
	for rows.Next() {
		ft := &FileTransfer{}
		var createdAt, updatedAt string
		var sessionStr sql.NullString
		err := rows.Scan(&ft.ID, &ft.FileName, &ft.FileSize, &ft.TotalChunks, &ft.Completed, &ft.Status, &sessionStr, &createdAt, &updatedAt)
		if err != nil {
			return nil, err
		}
		ft.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		ft.UpdatedAt, _ = time.Parse("2006-01-02 15:04:05", updatedAt)
		
		if sessionStr.Valid && sessionStr.String != "" {
			sidBytes, err := hex.DecodeString(sessionStr.String)
			if err == nil && len(sidBytes) == 16 {
				var sid [16]byte
				copy(sid[:], sidBytes)
				ft.SessionID = &sid
			}
		}
		
		transfers = append(transfers, ft)
	}
	return transfers, nil
}

func (s *Storage) GetCompletedChunks(transferID string) (map[int]bool, error) {
	rows, err := s.db.Query(`
		SELECT chunk_index FROM chunks WHERE transfer_id = ? AND status = 'completed'
	`, transferID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chunks := make(map[int]bool)
	for rows.Next() {
		var idx int
		if err := rows.Scan(&idx); err != nil {
			return nil, err
		}
		chunks[idx] = true
	}
	return chunks, nil
}

func (s *Storage) Close() error {
	return s.db.Close()
}
