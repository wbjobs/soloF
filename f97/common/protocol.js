const PACKET_TYPE = {
  DATA: 0x01,
  ACK: 0x02,
  SYN: 0x03,
  FIN: 0x04,
  RST: 0x05,
  HEARTBEAT: 0x06,
  RESUME_REQ: 0x07,
  RESUME_ACK: 0x08,
};

const CHUNK_SIZE = 1024;
const HEADER_SIZE = 7;
const MAX_SEQUENCE = 0xFFFFFFFF;

function createDataPacket(sequenceNumber, data) {
  const buffer = Buffer.alloc(HEADER_SIZE + data.length);
  buffer[0] = PACKET_TYPE.DATA;
  buffer.writeUInt32BE(sequenceNumber, 1);
  buffer.writeUInt16BE(data.length, 5);
  data.copy(buffer, HEADER_SIZE);
  return buffer;
}

function createAckPacket(ackNumber, windowSize = 65535) {
  const buffer = Buffer.alloc(9);
  buffer[0] = PACKET_TYPE.ACK;
  buffer.writeUInt32BE(ackNumber, 1);
  buffer.writeUInt32BE(windowSize, 5);
  return buffer;
}

function createSynPacket(fileId, fileSize, fileName, totalChunks) {
  const fileNameBuf = Buffer.from(fileName, 'utf8');
  const buffer = Buffer.alloc(1 + 4 + 8 + 2 + fileNameBuf.length + 4);
  let offset = 0;
  buffer[offset++] = PACKET_TYPE.SYN;
  buffer.writeUInt32BE(fileId, offset); offset += 4;
  buffer.writeBigUInt64BE(BigInt(fileSize), offset); offset += 8;
  buffer.writeUInt16BE(fileNameBuf.length, offset); offset += 2;
  fileNameBuf.copy(buffer, offset); offset += fileNameBuf.length;
  buffer.writeUInt32BE(totalChunks, offset);
  return buffer;
}

function createFinPacket(fileId, checksum = 0) {
  const buffer = Buffer.alloc(9);
  buffer[0] = PACKET_TYPE.FIN;
  buffer.writeUInt32BE(fileId, 1);
  buffer.writeUInt32BE(checksum, 5);
  return buffer;
}

function createResumeRequest(fileId) {
  const buffer = Buffer.alloc(5);
  buffer[0] = PACKET_TYPE.RESUME_REQ;
  buffer.writeUInt32BE(fileId, 1);
  return buffer;
}

function createResumeAck(fileId, bitmap) {
  const buffer = Buffer.alloc(5 + bitmap.length);
  buffer[0] = PACKET_TYPE.RESUME_ACK;
  buffer.writeUInt32BE(fileId, 1);
  Buffer.from(bitmap).copy(buffer, 5);
  return buffer;
}

function parsePacket(buffer) {
  if (buffer.length < 1) return null;
  const type = buffer[0];

  switch (type) {
    case PACKET_TYPE.DATA: {
      if (buffer.length < HEADER_SIZE) return null;
      return {
        type: 'DATA',
        sequenceNumber: buffer.readUInt32BE(1),
        length: buffer.readUInt16BE(5),
        data: buffer.slice(HEADER_SIZE, HEADER_SIZE + buffer.readUInt16BE(5)),
      };
    }
    case PACKET_TYPE.ACK: {
      if (buffer.length < 9) return null;
      return {
        type: 'ACK',
        ackNumber: buffer.readUInt32BE(1),
        windowSize: buffer.readUInt32BE(5),
      };
    }
    case PACKET_TYPE.SYN: {
      if (buffer.length < 15) return null;
      let offset = 1;
      const fileId = buffer.readUInt32BE(offset); offset += 4;
      const fileSize = Number(buffer.readBigUInt64BE(offset)); offset += 8;
      const nameLen = buffer.readUInt16BE(offset); offset += 2;
      const fileName = buffer.slice(offset, offset + nameLen).toString('utf8');
      offset += nameLen;
      const totalChunks = buffer.readUInt32BE(offset);
      return {
        type: 'SYN',
        fileId,
        fileSize,
        fileName,
        totalChunks,
      };
    }
    case PACKET_TYPE.FIN: {
      if (buffer.length < 9) return null;
      return {
        type: 'FIN',
        fileId: buffer.readUInt32BE(1),
        checksum: buffer.readUInt32BE(5),
      };
    }
    case PACKET_TYPE.RESUME_REQ: {
      if (buffer.length < 5) return null;
      return {
        type: 'RESUME_REQ',
        fileId: buffer.readUInt32BE(1),
      };
    }
    case PACKET_TYPE.RESUME_ACK: {
      if (buffer.length < 5) return null;
      return {
        type: 'RESUME_ACK',
        fileId: buffer.readUInt32BE(1),
        bitmap: Array.from(buffer.slice(5)),
      };
    }
    case PACKET_TYPE.HEARTBEAT: {
      return { type: 'HEARTBEAT' };
    }
    default:
      return null;
  }
}

module.exports = {
  PACKET_TYPE,
  CHUNK_SIZE,
  HEADER_SIZE,
  MAX_SEQUENCE,
  createDataPacket,
  createAckPacket,
  createSynPacket,
  createFinPacket,
  createResumeRequest,
  createResumeAck,
  parsePacket,
};
