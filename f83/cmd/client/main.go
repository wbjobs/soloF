package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"time"

	"reliable-udp/pkg/congestion"
	"reliable-udp/pkg/protocol"
)

type Client struct {
	conn       *net.UDPConn
	serverAddr *net.UDPAddr
	sessionID  [16]byte
	bbr        *congestion.BBR
	seqNum     uint32
	httpAddr   string
}

func NewClient(serverUDP, serverHTTP string) (*Client, error) {
	udpAddr, err := net.ResolveUDPAddr("udp", serverUDP)
	if err != nil {
		return nil, err
	}

	conn, err := net.ListenUDP("udp", nil)
	if err != nil {
		return nil, err
	}

	return &Client{
		conn:       conn,
		serverAddr: udpAddr,
		bbr:        congestion.NewBBR(),
		httpAddr:   serverHTTP,
	}, nil
}

func (c *Client) createUploadSession(filePath string) (string, int, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return "", 0, err
	}

	req := map[string]interface{}{
		"file_name": fileInfo.Name(),
		"file_size": fileInfo.Size(),
	}

	body, _ := json.Marshal(req)
	resp, err := http.Post(fmt.Sprintf("http://%s/upload", c.httpAddr), "application/json", bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	transferID := result["transfer_id"].(string)
	sessionIDHex := result["session_id"].(string)
	totalChunks := int(result["total_chunks"].(float64))

	sidBytes, _ := hex.DecodeString(sessionIDHex)
	copy(c.sessionID[:], sidBytes)

	return transferID, totalChunks, nil
}

func (c *Client) handshake() error {
	p := &protocol.Packet{
		Type:      protocol.PacketTypeHandshake,
		SessionID: c.sessionID,
	}
	c.conn.WriteToUDP(p.Serialize(), c.serverAddr)

	buf := make([]byte, 1500)
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _, err := c.conn.ReadFromUDP(buf)
	if err != nil {
		return err
	}

	resp, err := protocol.DeserializePacket(buf[:n])
	if err != nil {
		return err
	}

	if resp.Type != protocol.PacketTypeHandshakeACK {
		return fmt.Errorf("handshake failed")
	}

	return nil
}

func (c *Client) sendChunk(chunkIndex int, data []byte) error {
	blockSize := protocol.FECBlockSize
	numBlocks := (len(data) + blockSize - 1) / blockSize

	inFlight := 0
	sentPackets := make(map[uint32]time.Time)
	sentPacketsData := make(map[uint32][]byte)
	ackedPackets := make(map[uint32]bool)
	retransmitCount := make(map[uint32]int)
	fecGroupID := uint16(0)
	fecBlockIndex := 0
	var fecBuffer [][]byte

	for i := 0; i < numBlocks; {
		if !c.bbr.CanSend(inFlight) {
			time.Sleep(1 * time.Millisecond)
			continue
		}

		lossRate := c.bbr.GetLossRate()
		fecConfig := protocol.AdaptiveFECConfig(lossRate)

		start := i * blockSize
		end := start + blockSize
		if end > len(data) {
			end = len(data)
		}
		blockData := make([]byte, blockSize)
		copy(blockData, data[start:end])

		if fecBuffer == nil {
			fecBuffer = make([][]byte, 0, fecConfig.DataBlocks)
		}

		seq := c.seqNum
		p := &protocol.Packet{
			Type:            protocol.PacketTypeFECData,
			SessionID:       c.sessionID,
			SeqNum:          seq,
			ChunkIndex:      uint32(chunkIndex),
			FECGroupID:      fecGroupID,
			FECBlockIndex:   uint8(fecBlockIndex),
			FECDataBlocks:   uint8(fecConfig.DataBlocks),
			FECParityBlocks: uint8(fecConfig.ParityBlocks),
			Data:            blockData,
		}

		c.conn.WriteToUDP(p.Serialize(), c.serverAddr)
		sentPackets[seq] = time.Now()
		sentPacketsData[seq] = blockData
		fecBuffer = append(fecBuffer, blockData)
		inFlight++
		c.seqNum++
		fecBlockIndex++
		i++

		if fecBlockIndex >= fecConfig.DataBlocks {
			if err := c.sendFECParity(fecConfig, fecBuffer, fecGroupID, chunkIndex, &sentPackets, &sentPacketsData, &inFlight); err != nil {
				return err
			}
			fecGroupID++
			fecBlockIndex = 0
			fecBuffer = nil
		}

		c.bbr.OnPacketSent(len(p.Data))

		c.processIncoming(&sentPackets, &sentPacketsData, &ackedPackets, &retransmitCount, &inFlight, 10*time.Millisecond)
	}

	if fecBlockIndex > 0 {
		fecConfig := protocol.AdaptiveFECConfig(c.bbr.GetLossRate())
		for len(fecBuffer) < fecConfig.DataBlocks {
			fecBuffer = append(fecBuffer, make([]byte, blockSize))
		}
		if err := c.sendFECParity(fecConfig, fecBuffer, fecGroupID, chunkIndex, &sentPackets, &sentPacketsData, &inFlight); err != nil {
			return err
		}
	}

	deadline := time.Now().Add(10 * time.Second)
	for inFlight > 0 && time.Now().Before(deadline) {
		c.processIncoming(&sentPackets, &sentPacketsData, &ackedPackets, &retransmitCount, &inFlight, 50*time.Millisecond)
		
		if c.bbr.GetLossRate() > 0.3 && inFlight > int(float64(c.bbr.GetCWND())*0.5) {
			time.Sleep(20 * time.Millisecond)
		}
	}

	for seq, sendTime := range sentPackets {
		if !ackedPackets[seq] {
			if data, ok := sentPacketsData[seq]; ok {
				rtt := 5 * time.Second
				if time.Since(sendTime) > rtt {
					c.bbr.OnPacketLost(protocol.MaxPacketSize)
				}
			}
			delete(sentPackets, seq)
			delete(sentPacketsData, seq)
			inFlight--
		}
	}

	return nil
}

func (c *Client) sendFECParity(config protocol.FECConfig, dataBlocks [][]byte, groupID uint16, chunkIndex int,
	sentPackets *map[uint32]time.Time, sentPacketsData *map[uint32][]byte, inFlight *int) error {
	
	encoder := protocol.NewFECEncoder(config)
	encoded, err := encoder.Encode(dataBlocks)
	if err != nil {
		return err
	}

	for i := config.DataBlocks; i < len(encoded); i++ {
		parityData := encoded[i]
		seq := c.seqNum
		p := &protocol.Packet{
			Type:            protocol.PacketTypeFECData,
			SessionID:       c.sessionID,
			SeqNum:          seq,
			ChunkIndex:      uint32(chunkIndex),
			FECGroupID:      groupID,
			FECBlockIndex:   uint8(i),
			FECDataBlocks:   uint8(config.DataBlocks),
			FECParityBlocks: uint8(config.ParityBlocks),
			Data:            parityData,
		}

		c.conn.WriteToUDP(p.Serialize(), c.serverAddr)
		(*sentPackets)[seq] = time.Now()
		(*sentPacketsData)[seq] = parityData
		(*inFlight)++
		c.seqNum++
		c.bbr.OnPacketSent(len(parityData))
	}

	return nil
}

func (c *Client) processIncoming(sentPackets *map[uint32]time.Time, sentPacketsData *map[uint32][]byte, ackedPackets *map[uint32]bool, retransmitCount *map[uint32]int, inFlight *int, timeout time.Duration) {
	c.conn.SetReadDeadline(time.Now().Add(timeout))
	buf := make([]byte, 1500)
	n, _, err := c.conn.ReadFromUDP(buf)
	if err != nil {
		return
	}

	resp, err := protocol.DeserializePacket(buf[:n])
	if err != nil {
		return
	}

	switch resp.Type {
	case protocol.PacketTypeACK:
		if sendTime, ok := (*sentPackets)[resp.SeqNum]; ok {
			rtt := time.Since(sendTime)
			c.bbr.OnPacketAcked(protocol.MaxPacketSize, rtt)
			delete(*sentPackets, resp.SeqNum)
			delete(*sentPacketsData, resp.SeqNum)
			delete(*retransmitCount, resp.SeqNum)
			(*ackedPackets)[resp.SeqNum] = true
			(*inFlight)--
		}

	case protocol.PacketTypeNAK:
		for i := 0; i < len(resp.Data); i += 4 {
			nakSeq := binary.BigEndian.Uint32(resp.Data[i:])
			if (*ackedPackets)[nakSeq] {
				continue
			}
			
			count := (*retransmitCount)[nakSeq]
			if count >= protocol.MaxRetransmits {
				continue
			}
			
			delay := time.Duration(math.Pow(2, float64(count))) * protocol.RetransmitBaseDelay
			if delay > 2*time.Second {
				delay = 2 * time.Second
			}
			
			if lastSend, ok := (*sentPackets)[nakSeq]; ok {
				if time.Since(lastSend) < delay {
					continue
				}
			}
			
			if data, ok := (*sentPacketsData)[nakSeq]; ok {
				p := &protocol.Packet{
					Type:            protocol.PacketTypeFECData,
					SessionID:       c.sessionID,
					SeqNum:          nakSeq,
					ChunkIndex:      uint32(len(data) / protocol.ChunkSize),
					FECDataBlocks:   uint8(protocol.DefaultFEC.DataBlocks),
					FECParityBlocks: uint8(protocol.DefaultFEC.ParityBlocks),
					Data:            data,
				}
				c.conn.WriteToUDP(p.Serialize(), c.serverAddr)
				(*sentPackets)[nakSeq] = time.Now()
				(*retransmitCount)[nakSeq] = count + 1
				c.bbr.OnPacketLost(len(data))
			}
		}
	}
}

func (c *Client) SendFile(filePath string) (string, error) {
	transferID, totalChunks, err := c.createUploadSession(filePath)
	if err != nil {
		return "", err
	}

	if err := c.handshake(); err != nil {
		return "", err
	}

	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	chunkSize := protocol.ChunkSize
	buf := make([]byte, chunkSize)

	for chunkIndex := 0; chunkIndex < totalChunks; chunkIndex++ {
		n, err := file.Read(buf)
		if err != nil && err != io.EOF {
			return "", err
		}
		if n == 0 {
			break
		}

		if err := c.sendChunk(chunkIndex, buf[:n]); err != nil {
			fmt.Printf("Warning: chunk %d may have issues: %v\n", chunkIndex, err)
		}

		lossRate := c.bbr.GetLossRate()
		fecConfig := protocol.AdaptiveFECConfig(lossRate)
		redundancy := float64(fecConfig.ParityBlocks) / float64(fecConfig.DataBlocks) * 100
		
		fmt.Printf("Progress: %d/%d chunks (%.1f%%)\n", 
			chunkIndex+1, totalChunks, 
			float64(chunkIndex+1)/float64(totalChunks)*100)
		fmt.Printf("  BBR: cwnd=%d, rtt=%v, bw=%.2f MB/s, loss=%.2f%%\n",
			c.bbr.GetCWND(),
			c.bbr.GetRTT(),
			c.bbr.GetBandwidth()/1024/1024,
			lossRate*100)
		fmt.Printf("  FEC: %d+%d blocks (%.1f%% redundancy)\n",
			fecConfig.DataBlocks, fecConfig.ParityBlocks, redundancy)
	}

	return transferID, nil
}

func (c *Client) MigrateConnection() error {
	newConn, err := net.ListenUDP("udp", nil)
	if err != nil {
		return err
	}

	c.conn.Close()
	c.conn = newConn

	p := &protocol.Packet{
		Type:      protocol.PacketTypeMigrate,
		SessionID: c.sessionID,
	}
	c.conn.WriteToUDP(p.Serialize(), c.serverAddr)

	buf := make([]byte, 1500)
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _, err := c.conn.ReadFromUDP(buf)
	if err != nil {
		return err
	}

	resp, err := protocol.DeserializePacket(buf[:n])
	if err != nil {
		return err
	}

	if resp.Type != protocol.PacketTypeMigrateACK {
		return fmt.Errorf("migration failed")
	}

	fmt.Println("Connection migrated successfully")
	return nil
}

func (c *Client) Close() {
	c.conn.Close()
}

func main() {
	serverUDP := flag.String("udp", "127.0.0.1:8888", "Server UDP address")
	serverHTTP := flag.String("http", "127.0.0.1:8080", "Server HTTP address")
	filePath := flag.String("file", "", "File to send")
	migrate := flag.Bool("migrate", false, "Test connection migration")
	flag.Parse()

	if *filePath == "" {
		fmt.Println("Usage: client -file <path> [-migrate]")
		flag.PrintDefaults()
		os.Exit(1)
	}

	client, err := NewClient(*serverUDP, *serverHTTP)
	if err != nil {
		fmt.Printf("Failed to create client: %v\n", err)
		os.Exit(1)
	}
	defer client.Close()

	fmt.Printf("Sending file: %s\n", *filePath)
	transferID, err := client.SendFile(*filePath)
	if err != nil {
		fmt.Printf("Failed to send file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\nTransfer complete! Transfer ID: %s\n", transferID)
	fmt.Printf("Check progress: curl http://%s/progress?id=%s\n", *serverHTTP, transferID)
	fmt.Printf("Download file:   curl http://%s/download?id=%s\n", *serverHTTP, transferID)

	if *migrate {
		fmt.Println("\nTesting connection migration...")
		client.MigrateConnection()
	}
}
