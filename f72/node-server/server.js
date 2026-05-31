const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');

const app = express();
app.use(cors());

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const PORT = process.env.PORT || 3001;
const BROADCAST_DEBOUNCE_MS = 200;
const SCAN_BATCH_SIZE = 100;
const SNAPSHOT_INTERVAL_MS = 5000;
const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const SNAPSHOT_KEY_PREFIX = 'celery-monitor:snapshot:';

const redis = new Redis(REDIS_URL);
const subscriber = new Redis(REDIS_URL);

const taskStore = new Map();
const clients = new Set();
const pendingUpdates = new Map();
let broadcastTimer = null;
let cachedGraphData = null;
let cachedGraphHash = null;

subscriber.config('SET', 'notify-keyspace-events', 'KEA').catch(err => {
  console.warn('Could not set notify-keyspace-events:', err.message);
});

subscriber.psubscribe('__keyspace@0__:celery-task-meta-*', (err, count) => {
  if (err) {
    console.error('Subscription error:', err);
    return;
  }
  console.log(`Subscribed to ${count} keyspace channels`);
});

subscriber.on('pmessage', async (pattern, channel, message) => {
  const key = channel.replace('__keyspace@0__:', '');
  const taskId = key.replace('celery-task-meta-', '');

  pendingUpdates.set(taskId, { key, receivedAt: Date.now() });
  scheduleBroadcast();
});

async function processPendingUpdates() {
  if (pendingUpdates.size === 0) return;

  const updates = Array.from(pendingUpdates.entries());
  pendingUpdates.clear();

  try {
    const pipeline = redis.pipeline();
    for (const [, { key }] of updates) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();
    let hasChanges = false;

    for (let i = 0; i < updates.length; i++) {
      const [taskId] = updates[i];
      const [err, taskData] = results[i];

      if (err) {
        console.error('Error fetching task:', err);
        continue;
      }

      if (taskData) {
        try {
          const parsed = JSON.parse(taskData);
          if (updateTaskStore(taskId, parsed)) {
            hasChanges = true;
          }
        } catch (parseErr) {
          console.error('Error parsing task data:', parseErr);
        }
      }
    }

    if (hasChanges) {
      invalidateGraphCache();
    }
  } catch (err) {
    console.error('Error processing pending updates:', err);
  }
}

function scheduleBroadcast() {
  if (broadcastTimer) return;

  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    await processPendingUpdates();
    broadcastUpdate();
  }, BROADCAST_DEBOUNCE_MS);
}

async function scanAllKeys(pattern, batchSize = SCAN_BATCH_SIZE) {
  const keys = [];
  let cursor = '0';

  do {
    const [newCursor, batchKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
    cursor = newCursor;
    keys.push(...batchKeys);
  } while (cursor !== '0');

  return keys;
}

async function loadExistingTasks() {
  try {
    console.log('Loading existing tasks with SCAN...');
    const keys = await scanAllKeys('celery-task-meta-*');
    console.log(`Found ${keys.length} task keys`);

    if (keys.length === 0) {
      console.log('No existing tasks found');
      return;
    }

    const batchSize = 50;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const pipeline = redis.pipeline();

      for (const key of batch) {
        pipeline.get(key);
      }

      const results = await pipeline.exec();

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const [err, taskData] = results[j];

        if (err) {
          console.error('Error fetching task:', err);
          continue;
        }

        if (taskData) {
          try {
            const taskId = key.replace('celery-task-meta-', '');
            const parsed = JSON.parse(taskData);
            updateTaskStore(taskId, parsed);
          } catch (parseErr) {
            console.error('Error parsing task data:', parseErr);
          }
        }
      }

      await new Promise(resolve => setImmediate(resolve));
    }

    invalidateGraphCache();
    console.log(`Loaded ${taskStore.size} existing tasks`);
  } catch (err) {
    console.error('Error loading existing tasks:', err);
  }
}

function updateTaskStore(taskId, data) {
  const existing = taskStore.get(taskId);

  const statusChanged = !existing || existing.status !== data.status;
  const metaChanged = !existing || JSON.stringify(existing.meta) !== JSON.stringify(data.meta);
  const resultChanged = !existing || JSON.stringify(existing.result) !== JSON.stringify(data.result);

  if (!statusChanged && !metaChanged && !resultChanged) {
    return false;
  }

  const updated = {
    ...existing,
    id: taskId,
    status: data.status || existing?.status || 'UNKNOWN',
    result: data.result !== undefined ? data.result : existing?.result || null,
    traceback: data.traceback !== undefined ? data.traceback : existing?.traceback || null,
    children: data.children || existing?.children || [],
    meta: data.meta || existing?.meta || {},
    name: existing?.name || inferTaskName(data.result),
    updatedAt: Date.now(),
  };

  taskStore.set(taskId, updated);
  return true;
}

function inferTaskName(result) {
  if (result && typeof result === 'object') {
    if (result.data_id !== undefined) return 'process_data';
    if (result.total !== undefined) return 'analyze_result';
  }
  return 'unknown_task';
}

function hashObject(obj) {
  return JSON.stringify(obj);
}

function invalidateGraphCache() {
  cachedGraphData = null;
  cachedGraphHash = null;
}

function buildGraphData() {
  const currentHash = `${taskStore.size}-${Array.from(taskStore.values()).map(t => `${t.id}-${t.status}-${t.updatedAt}`).join(',')}`;

  if (cachedGraphData && cachedGraphHash === currentHash) {
    return cachedGraphData;
  }

  const nodes = [];
  const links = [];
  const seen = new Set();

  for (const task of taskStore.values()) {
    if (!seen.has(task.id)) {
      nodes.push({
        id: task.id,
        name: task.name,
        status: task.status,
        progress: task.meta?.progress || 0,
        result: task.result,
        updatedAt: task.updatedAt,
      });
      seen.add(task.id);
    }

    if (task.children && Array.isArray(task.children)) {
      for (const child of task.children) {
        const childId = typeof child === 'string' ? child : child[0];
        if (!seen.has(childId)) {
          const childTask = taskStore.get(childId);
          nodes.push({
            id: childId,
            name: childTask?.name || 'child_task',
            status: childTask?.status || 'UNKNOWN',
            progress: childTask?.meta?.progress || 0,
            result: childTask?.result || null,
            updatedAt: childTask?.updatedAt || Date.now(),
          });
          seen.add(childId);
        }
        links.push({
          source: task.id,
          target: childId,
        });
      }
    }
  }

  const graphData = { nodes, links };
  cachedGraphData = graphData;
  cachedGraphHash = currentHash;

  return graphData;
}

function broadcastUpdate() {
  const graphData = buildGraphData();
  const message = `data: ${JSON.stringify(graphData)}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch (err) {
      console.warn('Error writing to client:', err.message);
      clients.delete(client);
    }
  }
}

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('retry: 1000\n\n');

  const initialData = buildGraphData();
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

app.get('/api/tasks', (req, res) => {
  res.json(Array.from(taskStore.values()));
});

app.get('/api/graph', (req, res) => {
  res.json(buildGraphData());
});

app.delete('/api/tasks', async (req, res) => {
  try {
    const keys = await scanAllKeys('celery-task-meta-*');
    if (keys.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await redis.del(...batch);
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    taskStore.clear();
    invalidateGraphCache();
    broadcastUpdate();
    res.json({ cleared: keys.length });
  } catch (err) {
    console.error('Error clearing tasks:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    taskCount: taskStore.size,
    clientCount: clients.size,
    pendingUpdates: pendingUpdates.size,
  });
});

async function saveSnapshot() {
  try {
    const timestamp = Date.now();
    const graphData = buildGraphData();
    const snapshot = {
      timestamp,
      graphData,
      taskCount: taskStore.size,
    };

    const key = `${SNAPSHOT_KEY_PREFIX}${timestamp}`;
    await redis.setex(key, Math.ceil(SNAPSHOT_MAX_AGE_MS / 1000), JSON.stringify(snapshot));

    await cleanupOldSnapshots();

    return snapshot;
  } catch (err) {
    console.error('Error saving snapshot:', err);
  }
}

async function cleanupOldSnapshots() {
  try {
    const cutoffTime = Date.now() - SNAPSHOT_MAX_AGE_MS;
    const keys = await scanAllKeys(`${SNAPSHOT_KEY_PREFIX}*');
    
    const toDelete = keys.filter(key => {
      const ts = parseInt(key.replace(SNAPSHOT_KEY_PREFIX, ''));
      return ts < cutoffTime;
    });

    if (toDelete.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < toDelete.length; i += batchSize) {
        const batch = toDelete.slice(i, i + batchSize);
        await redis.del(...batch);
      }
    }
  } catch (err) {
    console.error('Error cleaning up snapshots:', err);
  }
}

app.get('/api/snapshots', async (req, res) => {
  try {
    const { from, to } = req.query;
    const now = Date.now();
    const startTime = from ? parseInt(from) : now - SNAPSHOT_MAX_AGE_MS;
    const endTime = to ? parseInt(to) : now;

    const keys = await scanAllKeys(`${SNAPSHOT_KEY_PREFIX}*`);
    const filteredKeys = keys
      .filter(key => {
        const ts = parseInt(key.replace(SNAPSHOT_KEY_PREFIX, ''));
        return ts >= startTime && ts <= endTime;
      })
      .sort();

    const timestamps = filteredKeys.map(key => parseInt(key.replace(SNAPSHOT_KEY_PREFIX, '')));

    res.json({
      startTime,
      endTime,
      count: timestamps.length,
      timestamps,
    });
  } catch (err) {
    console.error('Error getting snapshots:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/snapshot/:timestamp', async (req, res) => {
  try {
    const { timestamp } = req.params;
    const targetTs = parseInt(timestamp);

    const keys = await scanAllKeys(`${SNAPSHOT_KEY_PREFIX}*`);
    const sortedKeys = keys
      .map(key => {
        const ts = parseInt(key.replace(SNAPSHOT_KEY_PREFIX, ''));
        return { key, ts };
      })
      .sort((a, b) => a.ts - b.ts);

    if (sortedKeys.length === 0) {
      return res.status(404).json({ error: 'No snapshots found' });
    }

    let closest = sortedKeys[0];
    let minDiff = Math.abs(targetTs - closest.ts);

    for (const item of sortedKeys) {
      const diff = Math.abs(targetTs - item.ts);
      if (diff < minDiff) {
        minDiff = diff;
        closest = item;
      }
    }

    const data = await redis.get(closest.key);
    if (!data) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    const snapshot = JSON.parse(data);
    res.json(snapshot);
  } catch (err) {
    console.error('Error getting snapshot:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/snapshot/range', async (req, res) => {
  try {
    const { from, to, limit = 100 } = req.query;
    const now = Date.now();
    const startTime = from ? parseInt(from) : now - SNAPSHOT_MAX_AGE_MS;
    const endTime = to ? parseInt(to) : now;
    const maxLimit = Math.min(parseInt(limit), 200);

    const keys = await scanAllKeys(`${SNAPSHOT_KEY_PREFIX}*`);
    const filteredKeys = keys
      .map(key => {
        const ts = parseInt(key.replace(SNAPSHOT_KEY_PREFIX, ''));
        return { key, ts };
      })
      .filter(item => item.ts >= startTime && item.ts <= endTime)
      .sort((a, b) => a.ts - b.ts);

    if (filteredKeys.length === 0) {
      return res.json({ snapshots: [], count: 0 });
    }

    const step = Math.max(1, Math.ceil(filteredKeys.length / maxLimit));
    const sampledKeys = filteredKeys.filter((_, i) => i % step === 0);

    const pipeline = redis.pipeline();
    for (const item of sampledKeys) {
      pipeline.get(item.key);
    }

    const results = await pipeline.exec();
    const snapshots = results
      .map(([err, data]) => {
        if (err || !data) return null;
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json({
      startTime,
      endTime,
      count: snapshots.length,
      totalAvailable: filteredKeys.length,
      snapshots,
    });
  } catch (err) {
    console.error('Error getting snapshot range:', err);
    res.status(500).json({ error: err.message });
  }
});

let snapshotInterval = null;

app.listen(PORT, async () => {
  console.log(`SSE Server running on http://localhost:${PORT}`);
  console.log(`SSE Endpoint: http://localhost:${PORT}/events`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Snapshot interval: ${SNAPSHOT_INTERVAL_MS}ms, max age: ${SNAPSHOT_MAX_AGE_MS}ms`);
  await loadExistingTasks();
  broadcastUpdate();

  snapshotInterval = setInterval(saveSnapshot, SNAPSHOT_INTERVAL_MS);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
  }
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
  }
  redis.disconnect();
  subscriber.disconnect();
  process.exit(0);
});
