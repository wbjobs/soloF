package protocol

import (
	"encoding/binary"
	"errors"
)

const (
	PacketTypeData     = 0x01
	PacketTypeACK      = 0x02
	PacketTypeNAK      = 0x03
	PacketTypeHandshake = 0x04
	PacketTypeHandshakeACK = 0x05
	PacketTypeFinish   = 0x06
	PacketTypeFinishACK = 0x07
	PacketTypeMigrate  = 0x08
	PacketTypeMigrateACK = 0x09
	PacketTypeFECData    = 0x0A

	ChunkSize = 1024 * 1024
	MaxPacketSize = 1400
	HeaderSize = 30
)

type Packet struct {
	Type       uint8
	SessionID  [16]byte
	SeqNum     uint32
	ChunkIndex uint32
	FECGroupID uint16
	FECBlockIndex uint8
	FECDataBlocks uint8
	FECParityBlocks uint8
	Data       []byte
}

func (p *Packet) Serialize() []byte {
	dataLen := len(p.Data)
	buf := make([]byte, HeaderSize+dataLen)
	
	buf[0] = p.Type
	copy(buf[1:17], p.SessionID[:])
	binary.BigEndian.PutUint32(buf[17:21], p.SeqNum)
	binary.BigEndian.PutUint32(buf[21:25], p.ChunkIndex)
	binary.BigEndian.PutUint16(buf[25:27], p.FECGroupID)
	buf[27] = p.FECBlockIndex
	buf[28] = p.FECDataBlocks
	buf[29] = p.FECParityBlocks
	copy(buf[HeaderSize:], p.Data)
	
	return buf
}

func DeserializePacket(data []byte) (*Packet, error) {
	if len(data) < HeaderSize {
		return nil, errors.New("packet too small")
	}
	
	p := &Packet{}
	p.Type = data[0]
	copy(p.SessionID[:], data[1:17])
	p.SeqNum = binary.BigEndian.Uint32(data[17:21])
	p.ChunkIndex = binary.BigEndian.Uint32(data[21:25])
	p.FECGroupID = binary.BigEndian.Uint16(data[25:27])
	p.FECBlockIndex = data[27]
	p.FECDataBlocks = data[28]
	p.FECParityBlocks = data[29]
	
	dataLen := len(data) - HeaderSize
	if dataLen > 0 {
		p.Data = make([]byte, dataLen)
		copy(p.Data, data[HeaderSize:])
	}
	
	return p, nil
}
