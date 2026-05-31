package protocol

import (
	"encoding/binary"
	"math"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	MaxRetransmits        = 16
	RetransmitBaseDelay   = 10 * time.Millisecond
	NAKCooldown           = 50 * time.Millisecond
	FECBlockSize          = 1370
)

type FECGroup struct {
	groupID      uint16
	config       FECConfig
	blocks       [][]byte
	blockCount   int
	recvCount    int
	received     map[int]bool
	createdAt    time.Time
	processed    bool
}

func NewFECGroup(groupID uint16, config FECConfig) *FECGroup {
	total := config.DataBlocks + config.ParityBlocks
	return &FECGroup{
		groupID:   groupID,
		config:    config,
		blocks:    make([][]byte, total),
		received:  make(map[int]bool),
		createdAt: time.Now(),
	}
}

func (g *FECGroup) AddBlock(index int, data []byte) bool {
	if index < 0 || index >= len(g.blocks) {
		return false
	}
	if g.received[index] {
		return false
	}
	g.blocks[index] = make([]byte, len(data))
	copy(g.blocks[index], data)
	g.received[index] = true
	g.recvCount++
	return true
}

func (g *FECGroup) CanRecover() bool {
	missing := g.config.DataBlocks + g.config.ParityBlocks - g.recvCount
	return missing <= g.config.ParityBlocks
}

func (g *FECGroup) MissingCount() int {
	return g.config.DataBlocks + g.config.ParityBlocks - g.recvCount
}

func (g *FECGroup) Recover() ([][]byte, error) {
	if g.recvCount >= g.config.DataBlocks {
		if g.recvCount == g.config.DataBlocks+g.config.ParityBlocks {
			return g.blocks[:g.config.DataBlocks], nil
		}
	}

	decoder := NewFECDecoder(g.config)
	missingCount := g.MissingCount()
	
	if missingCount == 0 {
		g.processed = true
		return g.blocks[:g.config.DataBlocks], nil
	}

	if missingCount > g.config.ParityBlocks {
		return nil, nil
	}

	blocksCopy := make([][]byte, len(g.blocks))
	for i, b := range g.blocks {
		if b != nil {
			blocksCopy[i] = make([]byte, len(b))
			copy(blocksCopy[i], b)
		}
	}

	dataIndices := make([]int, g.config.DataBlocks)
	for i := range dataIndices {
		dataIndices[i] = i
	}
	parityIndices := make([]int, g.config.ParityBlocks)
	for i := range parityIndices {
		parityIndices[i] = g.config.DataBlocks + i
	}

	recovered, err := decoder.Decode(blocksCopy, dataIndices, parityIndices, missingCount)
	if err != nil {
		return nil, err
	}

	g.processed = true
	return recovered, nil
}

type Session struct {
	ID         [16]byte
	Conn       *net.UDPConn
	ClientAddr *net.UDPAddr
	mu         sync.RWMutex
	
	sendBase    uint32
	nextSeqNum  uint32
	recvBase    uint32
	
	sendBuffer  map[uint32]*Packet
	recvBuffer  map[uint32]*Packet
	ackReceived map[uint32]bool
	
	retransmitCount  map[uint32]int
	retransmitTime   map[uint32]time.Time
	
	nakSentTime   map[uint32]time.Time
	lastNAKCheck  time.Time
	
	chunkData   map[uint32][]byte
	chunkSize   int
	totalChunks uint32
	
	nakList     []uint32
	
	lastActivity time.Time
	isClosed     bool
	
	fecConfig      FECConfig
	fecEnabled     bool
	sendFECGroup   *FECGroup
	sendFECGroupID uint16
	sendBlockIndex int
	
	recvFECGroups  map[uint16]*FECGroup
	fecRecovered   uint64
	fecTotal       uint64
	
	lossRateWindow []float64
	currentLossRate float64
	
	onChunkComplete func(chunkIndex uint32, data []byte) error
}

func NewSession(conn *net.UDPConn, clientAddr *net.UDPAddr) *Session {
	sid := uuid.New()
	session := &Session{
		Conn:            conn,
		ClientAddr:      clientAddr,
		sendBuffer:      make(map[uint32]*Packet),
		recvBuffer:      make(map[uint32]*Packet),
		ackReceived:     make(map[uint32]bool),
		retransmitCount: make(map[uint32]int),
		retransmitTime:  make(map[uint32]time.Time),
		nakSentTime:     make(map[uint32]time.Time),
		chunkData:       make(map[uint32][]byte),
		chunkSize:       ChunkSize,
		nakList:         make([]uint32, 0),
		lastActivity:    time.Now(),
		lastNAKCheck:    time.Now(),
		fecConfig:       DefaultFEC,
		fecEnabled:      true,
		recvFECGroups:   make(map[uint16]*FECGroup),
		lossRateWindow:  make([]float64, 0, 100),
	}
	copy(session.ID[:], sid[:])
	return session
}

func SessionFromID(id [16]byte, conn *net.UDPConn, clientAddr *net.UDPAddr) *Session {
	session := &Session{
		ID:              id,
		Conn:            conn,
		ClientAddr:      clientAddr,
		sendBuffer:      make(map[uint32]*Packet),
		recvBuffer:      make(map[uint32]*Packet),
		ackReceived:     make(map[uint32]bool),
		retransmitCount: make(map[uint32]int),
		retransmitTime:  make(map[uint32]time.Time),
		nakSentTime:     make(map[uint32]time.Time),
		chunkData:       make(map[uint32][]byte),
		chunkSize:       ChunkSize,
		nakList:         make([]uint32, 0),
		lastActivity:    time.Now(),
		lastNAKCheck:    time.Now(),
		fecConfig:       DefaultFEC,
		fecEnabled:      true,
		recvFECGroups:   make(map[uint16]*FECGroup),
		lossRateWindow:  make([]float64, 0, 100),
	}
	return session
}

func (s *Session) SetOnChunkComplete(fn func(uint32, []byte) error) {
	s.onChunkComplete = fn
}

func (s *Session) EnableFEC(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fecEnabled = enabled
}

func (s *Session) UpdateFECConfig(lossRate float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.lossRateWindow = append(s.lossRateWindow, lossRate)
	if len(s.lossRateWindow) > 50 {
		s.lossRateWindow = s.lossRateWindow[1:]
	}
	
	avgLoss := 0.0
	for _, l := range s.lossRateWindow {
		avgLoss += l
	}
	avgLoss /= float64(len(s.lossRateWindow))
	s.currentLossRate = avgLoss
	
	newConfig := AdaptiveFECConfig(avgLoss)
	if newConfig.DataBlocks != s.fecConfig.DataBlocks || newConfig.ParityBlocks != s.fecConfig.ParityBlocks {
		s.fecConfig = newConfig
		if s.sendFECGroup != nil && s.sendFECGroup.blockCount > 0 {
			s.flushFECGroupLocked()
		}
	}
}

func (s *Session) GetFECConfig() FECConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.fecConfig
}

func (s *Session) GetLossRate() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentLossRate
}

func (s *Session) SendPacket(p *Packet) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sendPacketLocked(p)
}

func (s *Session) sendPacketLocked(p *Packet) error {
	copy(p.SessionID[:], s.ID[:])
	s.sendBuffer[p.SeqNum] = p
	
	if _, ok := s.retransmitCount[p.SeqNum]; !ok {
		s.retransmitCount[p.SeqNum] = 0
		s.retransmitTime[p.SeqNum] = time.Time{}
	}
	
	_, err := s.Conn.WriteToUDP(p.Serialize(), s.ClientAddr)
	if err != nil {
		return err
	}
	
	s.lastActivity = time.Now()
	return nil
}

func (s *Session) SendData(seqNum uint32, chunkIndex uint32, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if !s.fecEnabled {
		p := &Packet{
			Type:       PacketTypeData,
			SeqNum:     seqNum,
			ChunkIndex: chunkIndex,
			Data:       data,
		}
		return s.sendPacketLocked(p)
	}
	
	return s.sendFECDataLocked(seqNum, chunkIndex, data)
}

func (s *Session) sendFECDataLocked(seqNum uint32, chunkIndex uint32, data []byte) error {
	blockSize := FECBlockSize
	totalBlocks := (len(data) + blockSize - 1) / blockSize
	
	for i := 0; i < totalBlocks; i++ {
		start := i * blockSize
		end := start + blockSize
		if end > len(data) {
			end = len(data)
		}
		blockData := make([]byte, blockSize)
		copy(blockData, data[start:end])
		
		if s.sendFECGroup == nil {
			s.sendFECGroup = NewFECGroup(s.sendFECGroupID, s.fecConfig)
		}
		
		p := &Packet{
			Type:            PacketTypeFECData,
			SeqNum:          seqNum + uint32(i),
			ChunkIndex:      chunkIndex,
			FECGroupID:      s.sendFECGroup.groupID,
			FECBlockIndex:   uint8(s.sendBlockIndex),
			FECDataBlocks:   uint8(s.fecConfig.DataBlocks),
			FECParityBlocks: uint8(s.fecConfig.ParityBlocks),
			Data:            blockData,
		}
		
		s.sendFECGroup.blocks[s.sendBlockIndex] = blockData
		s.sendFECGroup.received[s.sendBlockIndex] = true
		s.sendFECGroup.blockCount++
		s.sendFECGroup.recvCount++
		
		if err := s.sendPacketLocked(p); err != nil {
			return err
		}
		
		s.sendBlockIndex++
		
		if s.sendBlockIndex >= s.fecConfig.DataBlocks {
			if err := s.flushFECGroupLocked(); err != nil {
				return err
			}
		}
	}
	
	return nil
}

func (s *Session) flushFECGroupLocked() error {
	if s.sendFECGroup == nil || s.sendFECGroup.blockCount == 0 {
		return nil
	}
	
	if s.sendFECGroup.blockCount < s.fecConfig.DataBlocks {
		padding := make([]byte, FECBlockSize)
		for i := s.sendFECGroup.blockCount; i < s.fecConfig.DataBlocks; i++ {
			s.sendFECGroup.blocks[i] = padding
			s.sendFECGroup.blockCount++
		}
	}
	
	dataBlocks := s.sendFECGroup.blocks[:s.fecConfig.DataBlocks]
	encoder := NewFECEncoder(s.fecConfig)
	encoded, err := encoder.Encode(dataBlocks)
	if err != nil {
		return err
	}
	
	for i := s.fecConfig.DataBlocks; i < len(encoded); i++ {
		parityData := encoded[i]
		p := &Packet{
			Type:            PacketTypeFECData,
			SeqNum:          s.nextSeqNum,
			ChunkIndex:      0,
			FECGroupID:      s.sendFECGroup.groupID,
			FECBlockIndex:   uint8(i),
			FECDataBlocks:   uint8(s.fecConfig.DataBlocks),
			FECParityBlocks: uint8(s.fecConfig.ParityBlocks),
			Data:            parityData,
		}
		
		s.nextSeqNum++
		if err := s.sendPacketLocked(p); err != nil {
			return err
		}
	}
	
	s.sendFECGroupID++
	s.sendFECGroup = nil
	s.sendBlockIndex = 0
	
	return nil
}

func (s *Session) SendACK(seqNum uint32) error {
	p := &Packet{
		Type:   PacketTypeACK,
		SeqNum: seqNum,
	}
	return s.SendPacket(p)
}

func (s *Session) sendACKLocked(seqNum uint32) error {
	p := &Packet{
		Type:   PacketTypeACK,
		SeqNum: seqNum,
	}
	return s.sendPacketLocked(p)
}

func (s *Session) SendNAK(missingSeq []uint32) error {
	data := make([]byte, len(missingSeq)*4)
	for i, seq := range missingSeq {
		binary.BigEndian.PutUint32(data[i*4:], seq)
	}
	
	p := &Packet{
		Type: PacketTypeNAK,
		Data: data,
	}
	return s.SendPacket(p)
}

func (s *Session) sendNAKLocked(missingSeq []uint32) error {
	now := time.Now()
	filtered := make([]uint32, 0, len(missingSeq))
	
	for _, seq := range missingSeq {
		if lastSent, exists := s.nakSentTime[seq]; exists {
			if now.Sub(lastSent) < NAKCooldown {
				continue
			}
		}
		s.nakSentTime[seq] = now
		filtered = append(filtered, seq)
	}
	
	if len(filtered) == 0 {
		return nil
	}
	
	data := make([]byte, len(filtered)*4)
	for i, seq := range filtered {
		binary.BigEndian.PutUint32(data[i*4:], seq)
	}
	
	p := &Packet{
		Type: PacketTypeNAK,
		Data: data,
	}
	return s.sendPacketLocked(p)
}

func (s *Session) FlushFEC() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushFECGroupLocked()
}

func (s *Session) HandlePacket(p *Packet) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	s.lastActivity = time.Now()
	
	switch p.Type {
	case PacketTypeData:
		return s.handleData(p)
	case PacketTypeFECData:
		return s.handleFECData(p)
	case PacketTypeACK:
		return s.handleACK(p)
	case PacketTypeNAK:
		return s.handleNAK(p)
	}
	return nil
}

func (s *Session) handleData(p *Packet) error {
	if _, exists := s.recvBuffer[p.SeqNum]; exists {
		s.sendACKLocked(p.SeqNum)
		return nil
	}
	
	s.recvBuffer[p.SeqNum] = p
	
	if p.SeqNum == s.recvBase {
		s.processInOrder()
	}
	
	s.checkForGapsLocked()
	s.sendACKLocked(p.SeqNum)
	
	return nil
}

func (s *Session) handleFECData(p *Packet) error {
	groupID := p.FECGroupID
	blockIdx := int(p.FECBlockIndex)
	config := FECConfig{
		DataBlocks:   int(p.FECDataBlocks),
		ParityBlocks: int(p.FECParityBlocks),
	}
	
	if config.DataBlocks == 0 {
		config = DefaultFEC
	}
	
	group, exists := s.recvFECGroups[groupID]
	if !exists {
		group = NewFECGroup(groupID, config)
		s.recvFECGroups[groupID] = group
	}
	
	group.AddBlock(blockIdx, p.Data)
	s.fecTotal++
	
	if blockIdx < config.DataBlocks {
		s.recvBuffer[p.SeqNum] = p
		if p.SeqNum == s.recvBase {
			s.processInOrder()
		}
	}
	
	if group.CanRecover() && !group.processed {
		s.tryRecoverFECGroup(group)
	}
	
	s.checkForGapsLocked()
	s.sendACKLocked(p.SeqNum)
	
	return nil
}

func (s *Session) tryRecoverFECGroup(group *FECGroup) {
	missing := group.MissingCount()
	if missing == 0 {
		group.processed = true
		s.cleanupOldFECGroups()
		return
	}
	
	if missing > group.config.ParityBlocks {
		return
	}
	
	recovered, err := group.Recover()
	if err != nil || recovered == nil {
		return
	}
	
	s.fecRecovered += uint64(missing)
	
	group.processed = true
	s.cleanupOldFECGroups()
}

func (s *Session) cleanupOldFECGroups() {
	now := time.Now()
	timeout := 5 * time.Second
	
	for id, group := range s.recvFECGroups {
		if group.processed || now.Sub(group.createdAt) > timeout {
			delete(s.recvFECGroups, id)
		}
	}
	
	if len(s.recvFECGroups) > 100 {
		var oldestID uint16
		var oldestTime time.Time
		first := true
		
		for id, group := range s.recvFECGroups {
			if first || group.createdAt.Before(oldestTime) {
				first = false
				oldestID = id
				oldestTime = group.createdAt
			}
		}
		
		if !first {
			delete(s.recvFECGroups, oldestID)
		}
	}
}

func (s *Session) handleACK(p *Packet) error {
	s.ackReceived[p.SeqNum] = true
	delete(s.sendBuffer, p.SeqNum)
	delete(s.retransmitCount, p.SeqNum)
	delete(s.retransmitTime, p.SeqNum)
	
	if p.SeqNum >= s.sendBase {
		s.sendBase = p.SeqNum + 1
	}
	
	return nil
}

func (s *Session) handleNAK(p *Packet) error {
	now := time.Now()
	retransmitted := 0
	
	for i := 0; i < len(p.Data); i += 4 {
		seq := binary.BigEndian.Uint32(p.Data[i:])
		
		count, exists := s.retransmitCount[seq]
		if !exists {
			continue
		}
		
		if count >= MaxRetransmits {
			continue
		}
		
		lastRetransmit := s.retransmitTime[seq]
		delay := time.Duration(math.Pow(2, float64(count))) * RetransmitBaseDelay
		delay = time.Duration(math.Min(float64(delay), float64(5*time.Second)))
		
		if !lastRetransmit.IsZero() && now.Sub(lastRetransmit) < delay {
			continue
		}
		
		pkt, ok := s.sendBuffer[seq]
		if !ok {
			continue
		}
		
		_, err := s.Conn.WriteToUDP(pkt.Serialize(), s.ClientAddr)
		if err != nil {
			continue
		}
		
		s.retransmitCount[seq]++
		s.retransmitTime[seq] = now
		retransmitted++
		
		if retransmitted >= 5 {
			break
		}
	}
	
	return nil
}

func (s *Session) processInOrder() {
	packetsPerChunk := (s.chunkSize + MaxPacketSize - HeaderSize - 1) / (MaxPacketSize - HeaderSize)
	
	for {
		p, ok := s.recvBuffer[s.recvBase]
		if !ok {
			break
		}
		
		chunkIdx := p.ChunkIndex
		if s.chunkData[chunkIdx] == nil {
			s.chunkData[chunkIdx] = make([]byte, 0, s.chunkSize)
		}
		
		dataLen := len(p.Data)
		if dataLen > 0 {
			actualLen := dataLen
			if p.Type == PacketTypeFECData && dataLen == FECBlockSize {
				trimmed := bytesTrimRightZero(p.Data)
				actualLen = len(trimmed)
				s.chunkData[chunkIdx] = append(s.chunkData[chunkIdx], trimmed...)
			} else {
				s.chunkData[chunkIdx] = append(s.chunkData[chunkIdx], p.Data...)
			}
			_ = actualLen
		}
		
		delete(s.recvBuffer, s.recvBase)
		s.recvBase++
		
		pktSeqInChunk := (s.recvBase - 1) % uint32(packetsPerChunk)
		if pktSeqInChunk == uint32(packetsPerChunk-1) || len(p.Data) < MaxPacketSize-HeaderSize {
			if data := s.chunkData[chunkIdx]; len(data) > 0 {
				if s.onChunkComplete != nil {
					s.onChunkComplete(chunkIdx, data)
				}
				delete(s.chunkData, chunkIdx)
			}
		}
	}
}

func bytesTrimRightZero(b []byte) []byte {
	for i := len(b) - 1; i >= 0; i-- {
		if b[i] != 0 {
			return b[:i+1]
		}
	}
	return nil
}

func (s *Session) checkForGapsLocked() {
	now := time.Now()
	if now.Sub(s.lastNAKCheck) < NAKCooldown {
		return
	}
	s.lastNAKCheck = now
	
	expected := s.recvBase
	missing := make([]uint32, 0)
	
	maxCheck := 20
	if maxCheck > len(s.recvBuffer)+10 {
		maxCheck = len(s.recvBuffer) + 10
	}
	
	for i := 0; i < maxCheck && len(missing) < 15; i++ {
		if _, ok := s.recvBuffer[expected]; !ok {
			missing = append(missing, expected)
		}
		expected++
	}
	
	if len(missing) > 0 {
		s.sendNAKLocked(missing)
	}
}

func (s *Session) GetStats() (sendBase uint32, recvBase uint32, buffered int, retransmitCount int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	totalRetransmits := 0
	for _, count := range s.retransmitCount {
		if count > 0 {
			totalRetransmits++
		}
	}
	
	return s.sendBase, s.recvBase, len(s.sendBuffer), totalRetransmits
}

func (s *Session) GetFECStats() (recovered uint64, total uint64, config FECConfig, lossRate float64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.fecRecovered, s.fecTotal, s.fecConfig, s.currentLossRate
}

func (s *Session) UpdateClientAddr(addr *net.UDPAddr) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ClientAddr = addr
	s.lastActivity = time.Now()
}

func (s *Session) IsExpired(timeout time.Duration) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return time.Since(s.lastActivity) > timeout
}

func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.isClosed = true
}

func (s *Session) GetRetransmitStats() map[uint32]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	result := make(map[uint32]int)
	for seq, count := range s.retransmitCount {
		if count > 0 {
			result[seq] = count
		}
	}
	return result
}
