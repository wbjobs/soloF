function decodePayload(hexPayload) {
  try {
    const buffer = Buffer.from(hexPayload, 'hex');
    
    if (buffer.length < 6) {
      throw new Error('Payload too short, expected 6 bytes');
    }

    const humidity = buffer.readUInt16BE(0) / 100;
    const temperature = buffer.readInt16BE(2) / 100;
    const conductivity = buffer.readInt16BE(4);

    if (conductivity < 0) {
      console.warn(`[WARN] Sensor fault detected: conductivity = ${conductivity} (negative value indicates sensor error)`);
    }

    if (humidity < 0 || humidity > 100) {
      console.warn(`[WARN] Abnormal humidity value: ${humidity}%`);
    }

    return {
      humidity: parseFloat(humidity.toFixed(2)),
      temperature: parseFloat(temperature.toFixed(2)),
      conductivity: conductivity
    };
  } catch (error) {
    console.error('[ERROR] Failed to decode payload:', error.message);
    throw error;
  }
}

function encodePayload(humidity, temperature, conductivity) {
  try {
    const buffer = Buffer.alloc(6);
    
    const humidityVal = Math.max(0, Math.min(65535, Math.round(humidity * 100)));
    const tempVal = Math.round(temperature * 100);
    const condVal = Math.round(conductivity);

    buffer.writeUInt16BE(humidityVal, 0);
    buffer.writeInt16BE(tempVal, 2);
    buffer.writeInt16BE(condVal, 4);
    
    return buffer.toString('hex');
  } catch (error) {
    console.error('[ERROR] Failed to encode payload:', error.message);
    throw error;
  }
}

module.exports = { decodePayload, encodePayload };
