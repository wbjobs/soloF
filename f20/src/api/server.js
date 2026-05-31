import express from 'express';
import cors from 'cors';

let streamManager = null;

function createApiRouter() {
  const router = express.Router();

  router.get('/streams', (req, res) => {
    try {
      const streams = streamManager.getAllStreamStats();
      res.json({ success: true, data: streams });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/streams/:id', (req, res) => {
    try {
      const { id } = req.params;
      const stats = streamManager.getStreamStats(id);
      
      if (!stats) {
        return res.status(404).json({ success: false, error: 'Stream not found' });
      }

      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/streams/:id', (req, res) => {
    try {
      const { id } = req.params;
      streamManager.removeStream(id);
      res.json({ success: true, message: 'Stream terminated' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/streams/:id/watermark', express.json(), (req, res) => {
    try {
      const { id } = req.params;
      const watermarkConfig = req.body;
      streamManager.updateWatermark(id, watermarkConfig);
      res.json({ success: true, message: 'Watermark updated' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/streams/:id/pip', express.json(), (req, res) => {
    try {
      const { id } = req.params;
      const pipConfig = req.body;
      streamManager.updatePiP(id, pipConfig);
      res.json({ success: true, message: 'PiP configuration updated' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/callbacks', express.json(), (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'Callback URL is required' });
      }
      streamManager.addEventCallback(url);
      res.json({ success: true, message: 'Callback URL added' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/callbacks', express.json(), (req, res) => {
    try {
      const { url } = req.body;
      streamManager.removeEventCallback(url);
      res.json({ success: true, message: 'Callback URL removed' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/health', (req, res) => {
    res.json({ success: true, message: 'API server is running' });
  });

  return router;
}

function initialize(port, manager) {
  streamManager = manager;
  
  const app = express();
  
  app.use(cors());
  app.use(express.json());
  
  app.use('/api', createApiRouter());

  app.listen(port, '0.0.0.0', () => {
    console.log(`API server running on http://0.0.0.0:${port}`);
  });
}

export default { initialize };
