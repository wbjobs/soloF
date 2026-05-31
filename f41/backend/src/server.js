const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const LoRaWANServer = require('./services/lorawanServer');
const dataService = require('./services/dataService');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

const loraWANServer = new LoRaWANServer(process.env.LORAWAN_PORT);
const { checkAlerts } = require('./config/alertRules');

loraWANServer.on('uplink', async (data) => {
  console.log('Uplink data received:', data);
  
  try {
    await dataService.insertSensorData(
      data.devEui,
      data.humidity,
      data.temperature,
      data.conductivity,
      data.timestamp
    );
    
    io.emit('sensorData', data);
    
    const alerts = checkAlerts(data);
    if (alerts.length > 0) {
      console.log(`[ALERT] Detected ${alerts.length} alerts for device ${data.devEui}`);
      alerts.forEach(alert => {
        io.emit('alert', {
          devEui: data.devEui,
          timestamp: data.timestamp,
          ...alert
        });
      });
    }
  } catch (error) {
    console.error('Error processing uplink data:', error);
  }
});

function startDataSimulation() {
  const devices = [
    { devEui: '0000000000000001', baseHumidity: 45, baseTemp: 22, baseCond: 1200 },
    { devEui: '0000000000000002', baseHumidity: 52, baseTemp: 24, baseCond: 1500 },
    { devEui: '0000000000000003', baseHumidity: 38, baseTemp: 20, baseCond: 900 }
  ];

  let interval = 0;
  devices.forEach(device => {
    setTimeout(() => {
      setInterval(() => {
        try {
          const humidity = device.baseHumidity + (Math.random() - 0.5) * 10;
          const temperature = device.baseTemp + (Math.random() - 0.5) * 4;
          
          let conductivity = device.baseCond + (Math.random() - 0.5) * 200;
          
          if (Math.random() < 0.05) {
            conductivity = -1;
            console.warn(`[SIM] Injecting sensor fault for ${device.devEui}: conductivity = ${conductivity}`);
          }
          
          loraWANServer.simulateUplink(
            device.devEui,
            parseFloat(humidity.toFixed(2)),
            parseFloat(temperature.toFixed(2)),
            Math.round(conductivity)
          );
        } catch (error) {
          console.error(`[ERROR] Data simulation failed for device ${device.devEui}:`, error.message);
        }
      }, 5000);
    }, interval);
    interval += 1500;
  });
  
  console.log('[INFO] Data simulation started for 3 sensor nodes');
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
  loraWANServer.start();
  startDataSimulation();
});
