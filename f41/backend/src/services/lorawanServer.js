const dgram = require('dgram');
const EventEmitter = require('events');
const { decodePayload } = require('../utils/payloadDecoder');

class LoRaWANServer extends EventEmitter {
  constructor(port = 1700) {
    super();
    this.port = port;
    this.server = dgram.createSocket('udp4');
    this.devices = new Map();
  }

  start() {
    this.server.on('message', (msg, rinfo) => {
      try {
        const data = this.parsePacket(msg);
        console.log(`Received LoRaWAN packet from ${rinfo.address}:${rinfo.port}`);
        this.emit('uplink', data);
      } catch (error) {
        console.error('Error parsing LoRaWAN packet:', error);
      }
    });

    this.server.on('listening', () => {
      const address = this.server.address();
      console.log(`LoRaWAN Network Server listening on ${address.address}:${address.port}`);
    });

    this.server.bind(this.port);
  }

  parsePacket(msg) {
    try {
      const jsonStr = msg.toString('utf8');
      const packet = JSON.parse(jsonStr);
      
      if (!packet.devEui) {
        throw new Error('Missing devEui in packet');
      }
      
      if (!packet.payload) {
        throw new Error('Missing payload in packet');
      }
      
      const decodedData = decodePayload(packet.payload);
      
      return {
        devEui: packet.devEui,
        timestamp: packet.timestamp || new Date().toISOString(),
        ...decodedData,
        rssi: packet.rssi || -50,
        snr: packet.snr || 10
      };
    } catch (error) {
      console.error(`[ERROR] Failed to parse LoRaWAN packet from ${msg.toString('hex').substring(0, 50)}...:`, error.message);
      throw error;
    }
  }

  simulateUplink(devEui, humidity, temperature, conductivity) {
    try {
      const { encodePayload } = require('../utils/payloadDecoder');
      const payload = encodePayload(humidity, temperature, conductivity);
      
      const packet = {
        devEui,
        payload,
        timestamp: new Date().toISOString(),
        rssi: -50 + Math.random() * 30,
        snr: 5 + Math.random() * 10
      };

      const data = this.parsePacket(Buffer.from(JSON.stringify(packet)));
      this.emit('uplink', data);
      
      return data;
    } catch (error) {
      console.error(`[ERROR] Failed to simulate uplink for device ${devEui}:`, error.message);
      return null;
    }
  }

  stop() {
    this.server.close();
  }
}

module.exports = LoRaWANServer;
