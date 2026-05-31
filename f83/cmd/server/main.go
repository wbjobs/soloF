package main

import (
	"encoding/hex"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"reliable-udp/pkg/congestion"
	"reliable-udp/pkg/protocol"
	"reliable-udp/pkg/storage"
	myhttp "reliable-udp/pkg/http"
)

type UDPServer struct {
	conn      *net.UDPConn
	sessions  map[[16]byte]*protocol.Session
	sessMu    sync.RWMutex
	storage   *storage.Storage
	dataDir   string
	bbrCtrl   map[[16]byte]*congestion.BBR
}

func NewUDPServer(addr string, storage *storage.Storage, dataDir string) (*UDPServer, error) {
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, err
	}

	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return nil, err
	}

	return &UDPServer{
		conn:     conn,
		sessions: make(map[[16]byte]*protocol.Session),
		storage:  storage,
		dataDir:  dataDir,
		bbrCtrl:  make(map[[16]byte]*congestion.BBR),
	}, nil
}

func (s *UDPServer) getOrCreateSession(sessionID [16]byte, clientAddr *net.UDPAddr) *protocol.Session {
	s.sessMu.Lock()
	defer s.sessMu.Unlock()

	if sess, ok := s.sessions[sessionID]; ok {
		sess.UpdateClientAddr(clientAddr)
		return sess
	}

	sess := protocol.SessionFromID(sessionID, s.conn, clientAddr)
	s.sessions[sessionID] = sess
	s.bbrCtrl[sessionID] = congestion.NewBBR()
	
	sess.SetOnChunkComplete(func(chunkIndex uint32, data []byte) error {
		return s.handleChunkComplete(sessionID, chunkIndex, data)
	})
	
	return sess
}

func (s *UDPServer) handleChunkComplete(sessionID [16]byte, chunkIndex uint32, data []byte) error {
	transfer, err := s.storage.GetTransferBySession(sessionID)
	if err != nil {
		log.Printf("Failed to get transfer for session: %v", err)
		return err
	}

	if err := s.storage.UpdateChunk(transfer.ID, int(chunkIndex), data); err != nil {
		log.Printf("Failed to update chunk: %v", err)
		return err
	}

	completedChunks, err := s.storage.GetCompletedChunks(transfer.ID)
	if err == nil && len(completedChunks) >= transfer.TotalChunks {
		s.assembleFile(transfer)
	}

	log.Printf("Chunk %d completed for transfer %s", chunkIndex, transfer.ID)
	return nil
}

func (s *UDPServer) assembleFile(transfer *storage.FileTransfer) {
	outPath := filepath.Join(s.dataDir, transfer.ID)
	outFile, err := os.Create(outPath)
	if err != nil {
		log.Printf("Failed to create output file: %v", err)
		return
	}
	defer outFile.Close()

	for i := 0; i < transfer.TotalChunks; i++ {
		chunk, err := s.storage.GetChunk(transfer.ID, i)
		if err != nil {
			log.Printf("Failed to get chunk %d: %v", i, err)
			return
		}
		outFile.Write(chunk.Data)
	}

	s.storage.MarkTransferComplete(transfer.ID)
	log.Printf("File transfer completed: %s", transfer.ID)
}

func (s *UDPServer) handleHandshake(clientAddr *net.UDPAddr, p *protocol.Packet) {
	sess := s.getOrCreateSession(p.SessionID, clientAddr)
	
	resp := &protocol.Packet{
		Type:   protocol.PacketTypeHandshakeACK,
		SeqNum: 0,
	}
	sess.SendPacket(resp)
}

func (s *UDPServer) handleMigrate(clientAddr *net.UDPAddr, p *protocol.Packet) {
	s.sessMu.RLock()
	sess, exists := s.sessions[p.SessionID]
	s.sessMu.RUnlock()
	
	if exists {
		sess.UpdateClientAddr(clientAddr)
		resp := &protocol.Packet{
			Type:   protocol.PacketTypeMigrateACK,
			SeqNum: 0,
		}
		sess.SendPacket(resp)
		log.Printf("Session migrated: %s -> %s", hex.EncodeToString(p.SessionID[:]), clientAddr.String())
	}
}

func (s *UDPServer) Serve() error {
	buf := make([]byte, 2048)
	timeout := 5 * time.Minute

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			s.cleanupSessions(timeout)
		}
	}()

	for {
		n, clientAddr, err := s.conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("Read error: %v", err)
			continue
		}

		p, err := protocol.DeserializePacket(buf[:n])
		if err != nil {
			log.Printf("Packet parse error: %v", err)
			continue
		}

		switch p.Type {
		case protocol.PacketTypeHandshake:
			s.handleHandshake(clientAddr, p)
		case protocol.PacketTypeMigrate:
			s.handleMigrate(clientAddr, p)
		case protocol.PacketTypeData, protocol.PacketTypeFECData, protocol.PacketTypeACK, protocol.PacketTypeNAK:
			sess := s.getOrCreateSession(p.SessionID, clientAddr)
			sess.HandlePacket(p)
			
			if p.Type == protocol.PacketTypeACK || p.Type == protocol.PacketTypeNAK {
				bbr, exists := s.bbrCtrl[p.SessionID]
				if exists {
					lossRate := bbr.GetLossRate()
					sess.UpdateFECConfig(lossRate)
				}
			}
		}
	}
}

func (s *UDPServer) cleanupSessions(timeout time.Duration) {
	s.sessMu.Lock()
	defer s.sessMu.Unlock()
	
	for id, sess := range s.sessions {
		if sess.IsExpired(timeout) {
			delete(s.sessions, id)
			delete(s.bbrCtrl, id)
			log.Printf("Session expired: %s", hex.EncodeToString(id[:]))
		}
	}
}

func main() {
	dataDir := "./data"
	os.MkdirAll(dataDir, 0755)

	storage, err := storage.NewStorage("./data/transfers.db")
	if err != nil {
		log.Fatal(err)
	}
	defer storage.Close()

	udpServer, err := NewUDPServer(":8888", storage, dataDir)
	if err != nil {
		log.Fatal(err)
	}

	go func() {
		log.Printf("UDP server starting on :8888")
		if err := udpServer.Serve(); err != nil {
			log.Fatal(err)
		}
	}()

	httpHandler := myhttp.NewHandler(storage, dataDir, &udpServer.sessions, &udpServer.sessMu)
	
	mux := http.NewServeMux()
	mux.HandleFunc("/upload", httpHandler.UploadHandler)
	mux.HandleFunc("/download", httpHandler.DownloadHandler)
	mux.HandleFunc("/progress", httpHandler.ProgressHandler)
	mux.HandleFunc("/transfers", httpHandler.ListHandler)

	log.Printf("HTTP server starting on :8080")
	log.Printf("Endpoints:")
	log.Printf("  POST /upload - Create upload session")
	log.Printf("  GET  /progress?id=XXX - Check transfer progress")
	log.Printf("  GET  /download?id=XXX - Download completed file")
	log.Printf("  GET  /transfers - List all transfers")
	
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}
