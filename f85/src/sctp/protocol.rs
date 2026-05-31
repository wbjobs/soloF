use bytes::{Buf, BufMut, Bytes, BytesMut};
use std::net::{IpAddr, SocketAddr};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("Packet too short: need {need}, have {have}")]
    PacketTooShort { need: usize, have: usize },
    #[error("Invalid chunk type: {0}")]
    InvalidChunkType(u8),
    #[error("Invalid chunk length: {0}")]
    InvalidChunkLength(usize),
    #[error("Checksum mismatch")]
    ChecksumMismatch,
    #[error("Invalid parameter type: {0}")]
    InvalidParameterType(u16),
    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u8),
}

pub const SCTP_PORT: u16 = 9000;
pub const SCTP_PROTOCOL_VERSION: u8 = 0;
pub const SCTP_HEADER_SIZE: usize = 12;
pub const CHUNK_HEADER_SIZE: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ChunkType {
    Data = 0,
    Init = 1,
    InitAck = 2,
    Sack = 3,
    Heartbeat = 4,
    HeartbeatAck = 5,
    Abort = 6,
    Shutdown = 7,
    ShutdownAck = 8,
    Error = 9,
    CookieEcho = 10,
    CookieAck = 11,
    Ecne = 12,
    Cwr = 13,
    ShutdownComplete = 14,
    Auth = 15,
    IData = 64,
    Priority = 130,
    Unknown = 255,
}

impl ChunkType {
    pub fn from_u8(val: u8) -> Self {
        match val {
            0 => ChunkType::Data,
            1 => ChunkType::Init,
            2 => ChunkType::InitAck,
            3 => ChunkType::Sack,
            4 => ChunkType::Heartbeat,
            5 => ChunkType::HeartbeatAck,
            6 => ChunkType::Abort,
            7 => ChunkType::Shutdown,
            8 => ChunkType::ShutdownAck,
            9 => ChunkType::Error,
            10 => ChunkType::CookieEcho,
            11 => ChunkType::CookieAck,
            12 => ChunkType::Ecne,
            13 => ChunkType::Cwr,
            14 => ChunkType::ShutdownComplete,
            15 => ChunkType::Auth,
            64 => ChunkType::IData,
            130 => ChunkType::Priority,
            _ => ChunkType::Unknown,
        }
    }

    pub fn to_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChunkFlags {
    pub inner: u8,
}

impl ChunkFlags {
    pub fn new() -> Self {
        Self { inner: 0 }
    }

    pub fn from_u8(val: u8) -> Self {
        Self { inner: val }
    }

    pub fn to_u8(self) -> u8 {
        self.inner
    }

    pub fn is_set(&self, bit: u8) -> bool {
        (self.inner & (1 << bit)) != 0
    }

    pub fn set(&mut self, bit: u8) {
        self.inner |= 1 << bit;
    }
}

impl Default for ChunkFlags {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataChunkFlags {
    FirstFragment = 0,
    LastFragment = 1,
    Unordered = 2,
}

#[derive(Debug, Clone)]
pub struct SctpHeader {
    pub src_port: u16,
    pub dst_port: u16,
    pub verification_tag: u32,
    pub checksum: u32,
}

impl SctpHeader {
    pub fn new(src_port: u16, dst_port: u16, verification_tag: u32) -> Self {
        Self {
            src_port,
            dst_port,
            verification_tag,
            checksum: 0,
        }
    }

    pub fn parse(buf: &mut impl Buf) -> Result<Self, ProtocolError> {
        if buf.remaining() < SCTP_HEADER_SIZE {
            return Err(ProtocolError::PacketTooShort {
                need: SCTP_HEADER_SIZE,
                have: buf.remaining(),
            });
        }
        Ok(Self {
            src_port: buf.get_u16(),
            dst_port: buf.get_u16(),
            verification_tag: buf.get_u32(),
            checksum: buf.get_u32(),
        })
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u16(self.src_port);
        buf.put_u16(self.dst_port);
        buf.put_u32(self.verification_tag);
        buf.put_u32(self.checksum);
    }

    pub fn encode_with_checksum(&self, buf: &mut BytesMut) {
        let start = buf.len();
        buf.put_u16(self.src_port);
        buf.put_u16(self.dst_port);
        buf.put_u32(self.verification_tag);
        buf.put_u32(0);
        let end = buf.len();
        let checksum = crc32c(&buf[start..end]);
        buf[start + 8..start + 12].copy_from_slice(&checksum.to_be_bytes());
    }
}

#[derive(Debug, Clone)]
pub struct SctpChunk {
    pub chunk_type: ChunkType,
    pub flags: ChunkFlags,
    pub length: u16,
    pub value: Bytes,
}

impl SctpChunk {
    pub fn new(chunk_type: ChunkType, flags: ChunkFlags, value: Bytes) -> Self {
        let length = (CHUNK_HEADER_SIZE + value.len()) as u16;
        Self {
            chunk_type,
            flags,
            length,
            value,
        }
    }

    pub fn parse(buf: &mut impl Buf) -> Result<Self, ProtocolError> {
        if buf.remaining() < CHUNK_HEADER_SIZE {
            return Err(ProtocolError::PacketTooShort {
                need: CHUNK_HEADER_SIZE,
                have: buf.remaining(),
            });
        }

        let chunk_type = ChunkType::from_u8(buf.get_u8());
        let flags = ChunkFlags::from_u8(buf.get_u8());
        let length = buf.get_u16();

        if length < CHUNK_HEADER_SIZE as u16 {
            return Err(ProtocolError::InvalidChunkLength(length as usize));
        }

        let value_len = (length as usize) - CHUNK_HEADER_SIZE;
        if buf.remaining() < value_len {
            return Err(ProtocolError::PacketTooShort {
                need: value_len,
                have: buf.remaining(),
            });
        }

        let value = buf.copy_to_bytes(value_len);
        let padding = (4 - (length as usize % 4)) % 4;
        if buf.remaining() >= padding {
            buf.advance(padding);
        }

        Ok(Self {
            chunk_type,
            flags,
            length,
            value,
        })
    }

    pub fn encode(&self, buf: &mut BytesMut) {
        buf.put_u8(self.chunk_type.to_u8());
        buf.put_u8(self.flags.to_u8());
        buf.put_u16(self.length);
        buf.put_slice(&self.value);
        let padding = (4 - (self.length as usize % 4)) % 4;
        for _ in 0..padding {
            buf.put_u8(0);
        }
    }
}

#[derive(Debug, Clone)]
pub struct SctpPacket {
    pub header: SctpHeader,
    pub chunks: Vec<SctpChunk>,
}

impl SctpPacket {
    pub fn new(header: SctpHeader, chunks: Vec<SctpChunk>) -> Self {
        Self { header, chunks }
    }

    pub fn parse(buf: &mut impl Buf) -> Result<Self, ProtocolError> {
        let header = SctpHeader::parse(buf)?;
        let mut chunks = Vec::new();

        while buf.remaining() >= CHUNK_HEADER_SIZE {
            match SctpChunk::parse(buf) {
                Ok(chunk) => chunks.push(chunk),
                Err(e) => {
                    tracing::warn!("Failed to parse chunk: {:?}", e);
                    break;
                }
            }
        }

        Ok(Self { header, chunks })
    }

    pub fn encode(&self) -> BytesMut {
        let total_size = SCTP_HEADER_SIZE
            + self
                .chunks
                .iter()
                .map(|c| {
                    let padded = (c.length as usize + 3) & !3;
                    padded
                })
                .sum::<usize>();

        let mut buf = BytesMut::with_capacity(total_size);
        self.header.encode(&mut buf);
        for chunk in &self.chunks {
            chunk.encode(&mut buf);
        }
        buf
    }

    pub fn data_chunks(&self) -> impl Iterator<Item = &SctpChunk> {
        self.chunks
            .iter()
            .filter(|c| c.chunk_type == ChunkType::Data || c.chunk_type == ChunkType::IData)
    }
}

#[derive(Debug, Clone)]
pub struct DataChunkPayload {
    pub tsn: u32,
    pub stream_id: u16,
    pub stream_seq: u16,
    pub payload_proto: u32,
    pub user_data: Bytes,
}

impl DataChunkPayload {
    pub fn parse(chunk: &SctpChunk) -> Result<Self, ProtocolError> {
        let mut buf = chunk.value.as_ref();
        if buf.remaining() < 16 {
            return Err(ProtocolError::PacketTooShort {
                need: 16,
                have: buf.remaining(),
            });
        }

        let tsn = buf.get_u32();
        let stream_id = buf.get_u16();
        let stream_seq = buf.get_u16();
        let payload_proto = buf.get_u32();
        let user_data = buf.copy_to_bytes(buf.remaining());

        Ok(Self {
            tsn,
            stream_id,
            stream_seq,
            payload_proto,
            user_data,
        })
    }

    pub fn encode(&self, flags: ChunkFlags) -> SctpChunk {
        let mut buf = BytesMut::with_capacity(16 + self.user_data.len());
        buf.put_u32(self.tsn);
        buf.put_u16(self.stream_id);
        buf.put_u16(self.stream_seq);
        buf.put_u32(self.payload_proto);
        buf.put_slice(&self.user_data);
        SctpChunk::new(ChunkType::Data, flags, buf.freeze())
    }
}

#[derive(Debug, Clone)]
pub struct InitChunkPayload {
    pub init_tag: u32,
    pub a_rwnd: u32,
    pub num_outbound_streams: u16,
    pub num_inbound_streams: u16,
    pub initial_tsn: u32,
    pub params: Vec<InitParam>,
}

#[derive(Debug, Clone)]
pub enum InitParam {
    IPv4Addr(IpAddr),
    IPv6Addr(IpAddr),
    StateCookie(Vec<u8>),
    UnrecognizedParameter(u16, Vec<u8>),
    SupportedExtensions(Vec<u8>),
    Random(Vec<u8>),
    HostName(String),
    Unknown(u16, Vec<u8>),
}

impl InitChunkPayload {
    pub fn parse(chunk: &SctpChunk) -> Result<Self, ProtocolError> {
        let mut buf = chunk.value.as_ref();
        if buf.remaining() < 16 {
            return Err(ProtocolError::PacketTooShort {
                need: 16,
                have: buf.remaining(),
            });
        }

        let init_tag = buf.get_u32();
        let a_rwnd = buf.get_u32();
        let num_outbound_streams = buf.get_u16();
        let num_inbound_streams = buf.get_u16();
        let initial_tsn = buf.get_u32();

        let mut params = Vec::new();
        while buf.remaining() >= 4 {
            let param_type = buf.get_u16();
            let param_length = buf.get_u16();
            if param_length < 4 || buf.remaining() < param_length as usize - 4 {
                break;
            }
            let param_value = buf.copy_to_bytes(param_length as usize - 4);

            let param = match param_type {
                0x0005 | 0x0006 => {
                    if param_value.len() >= 4 {
                        let ip = match param_value.len() {
                            4 => IpAddr::V4(std::net::Ipv4Addr::new(
                                param_value[0],
                                param_value[1],
                                param_value[2],
                                param_value[3],
                            )),
                            16 => {
                                let v6 = std::net::Ipv6Addr::from(
                                    <[u8; 16]>::try_from(&param_value[..16]).unwrap(),
                                );
                                IpAddr::V6(v6)
                            }
                            _ => continue,
                        };
                        if param_type == 0x0005 {
                            InitParam::IPv4Addr(ip)
                        } else {
                            InitParam::IPv6Addr(ip)
                        }
                    } else {
                        continue;
                    }
                }
                0x0007 => InitParam::StateCookie(param_value.to_vec()),
                0x8008 => InitParam::SupportedExtensions(param_value.to_vec()),
                0x8002 => InitParam::Random(param_value.to_vec()),
                0x0011 => {
                    InitParam::HostName(String::from_utf8_lossy(&param_value).to_string())
                }
                _ => InitParam::Unknown(param_type, param_value.to_vec()),
            };
            params.push(param);
        }

        Ok(Self {
            init_tag,
            a_rwnd,
            num_outbound_streams,
            num_inbound_streams,
            initial_tsn,
            params,
        })
    }

    pub fn encode(&self, chunk_type: ChunkType) -> SctpChunk {
        let mut buf = BytesMut::new();
        buf.put_u32(self.init_tag);
        buf.put_u32(self.a_rwnd);
        buf.put_u16(self.num_outbound_streams);
        buf.put_u16(self.num_inbound_streams);
        buf.put_u32(self.initial_tsn);

        for param in &self.params {
            match param {
                InitParam::IPv4Addr(ip) => {
                    if let IpAddr::V4(v4) = ip {
                        buf.put_u16(0x0005);
                        buf.put_u16(8);
                        buf.put_slice(&v4.octets());
                    }
                }
                InitParam::IPv6Addr(ip) => {
                    if let IpAddr::V6(v6) = ip {
                        buf.put_u16(0x0006);
                        buf.put_u16(20);
                        buf.put_slice(&v6.octets());
                    }
                }
                InitParam::StateCookie(cookie) => {
                    buf.put_u16(0x0007);
                    buf.put_u16(4 + cookie.len() as u16);
                    buf.put_slice(cookie);
                }
                _ => {}
            }
        }

        SctpChunk::new(chunk_type, ChunkFlags::new(), buf.freeze())
    }
}

#[derive(Debug, Clone)]
pub struct SackChunkPayload {
    pub cumulative_tsn_ack: u32,
    pub a_rwnd: u32,
    pub num_gap_ack_blocks: u16,
    pub num_dup_tsns: u16,
    pub gap_ack_blocks: Vec<(u16, u16)>,
    pub dup_tsns: Vec<u32>,
}

impl SackChunkPayload {
    pub fn parse(chunk: &SctpChunk) -> Result<Self, ProtocolError> {
        let mut buf = chunk.value.as_ref();
        if buf.remaining() < 12 {
            return Err(ProtocolError::PacketTooShort {
                need: 12,
                have: buf.remaining(),
            });
        }

        let cumulative_tsn_ack = buf.get_u32();
        let a_rwnd = buf.get_u32();
        let num_gap_ack_blocks = buf.get_u16();
        let num_dup_tsns = buf.get_u16();

        let mut gap_ack_blocks = Vec::new();
        for _ in 0..num_gap_ack_blocks {
            if buf.remaining() >= 4 {
                gap_ack_blocks.push((buf.get_u16(), buf.get_u16()));
            }
        }

        let mut dup_tsns = Vec::new();
        for _ in 0..num_dup_tsns {
            if buf.remaining() >= 4 {
                dup_tsns.push(buf.get_u32());
            }
        }

        Ok(Self {
            cumulative_tsn_ack,
            a_rwnd,
            num_gap_ack_blocks,
            num_dup_tsns,
            gap_ack_blocks,
            dup_tsns,
        })
    }

    pub fn encode(&self) -> SctpChunk {
        let mut buf =
            BytesMut::with_capacity(12 + self.gap_ack_blocks.len() * 4 + self.dup_tsns.len() * 4);
        buf.put_u32(self.cumulative_tsn_ack);
        buf.put_u32(self.a_rwnd);
        buf.put_u16(self.gap_ack_blocks.len() as u16);
        buf.put_u16(self.dup_tsns.len() as u16);

        for (start, end) in &self.gap_ack_blocks {
            buf.put_u16(*start);
            buf.put_u16(*end);
        }

        for tsn in &self.dup_tsns {
            buf.put_u32(*tsn);
        }

        SctpChunk::new(ChunkType::Sack, ChunkFlags::new(), buf.freeze())
    }
}

pub fn crc32c(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0x82F63B78;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

pub fn generate_verification_tag() -> u32 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    rng.gen()
}

pub fn generate_initial_tsn() -> u32 {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    rng.gen()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::BytesMut;

    #[test]
    fn test_sctp_header_encode_decode() {
        let header = SctpHeader::new(5000, 9000, 0x12345678);
        let mut buf = BytesMut::new();
        header.encode(&mut buf);
        let mut reader = buf.as_ref();
        let parsed = SctpHeader::parse(&mut reader).unwrap();
        assert_eq!(parsed.src_port, 5000);
        assert_eq!(parsed.dst_port, 9000);
        assert_eq!(parsed.verification_tag, 0x12345678);
    }

    #[test]
    fn test_sctp_packet_encode_decode() {
        let header = SctpHeader::new(5000, 9000, 0x12345678);
        let payload = DataChunkPayload {
            tsn: 1,
            stream_id: 0,
            stream_seq: 0,
            payload_proto: 0,
            user_data: Bytes::from_static(b"hello"),
        };
        let chunk = payload.encode(ChunkFlags::new());
        let packet = SctpPacket::new(header, vec![chunk]);
        let encoded = packet.encode();
        let mut reader = encoded.as_ref();
        let parsed = SctpPacket::parse(&mut reader).unwrap();
        assert_eq!(parsed.chunks.len(), 1);
        let data = DataChunkPayload::parse(&parsed.chunks[0]).unwrap();
        assert_eq!(data.user_data, Bytes::from_static(b"hello"));
    }

    #[test]
    fn test_crc32c() {
        let data = b"test data";
        let crc = crc32c(data);
        assert_ne!(crc, 0);
        assert_eq!(crc, crc32c(data));
    }
}
