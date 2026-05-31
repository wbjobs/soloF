use std::collections::{BinaryHeap, HashMap};
use std::cmp::Reverse;
use std::time::{Duration, Instant};

use bytes::Bytes;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::types::*;

const DEFAULT_QUEUE_SIZE: usize = 4096;
const DEFAULT_TOKEN_REFILL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoSPolicy {
    pub stream_id: StreamId,
    pub priority: u8,
    pub bandwidth_limit_bps: Option<u64>,
    pub max_queue_size: usize,
}

impl Default for QoSPolicy {
    fn default() -> Self {
        Self {
            stream_id: 0,
            priority: 5,
            bandwidth_limit_bps: None,
            max_queue_size: DEFAULT_QUEUE_SIZE,
        }
    }
}

impl From<QoSConfig> for QoSPolicy {
    fn from(config: QoSConfig) -> Self {
        Self {
            stream_id: 0,
            priority: config.priority,
            bandwidth_limit_bps: config.bandwidth_limit_bps,
            max_queue_size: DEFAULT_QUEUE_SIZE,
        }
    }
}

#[derive(Debug, Clone)]
struct RateLimiter {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

impl RateLimiter {
    fn new(bandwidth_bps: u64) -> Self {
        let max_tokens = bandwidth_bps as f64 * 2.0;
        Self {
            tokens: max_tokens,
            max_tokens,
            refill_rate: bandwidth_bps as f64,
            last_refill: Instant::now(),
        }
    }

    fn try_consume(&mut self, bytes: usize) -> bool {
        self.refill();
        let required = bytes as f64;
        if self.tokens >= required {
            self.tokens -= required;
            true
        } else {
            false
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        let new_tokens = elapsed * self.refill_rate;
        self.tokens = (self.tokens + new_tokens).min(self.max_tokens);
        self.last_refill = now;
    }

    fn available_tokens(&mut self) -> f64 {
        self.refill();
        self.tokens
    }
}

#[derive(Debug, Clone)]
struct PriorityItem {
    priority: u8,
    timestamp: Instant,
    data: Bytes,
    stream_id: StreamId,
    seq: u64,
}

impl PartialEq for PriorityItem {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.timestamp == other.timestamp
    }
}

impl Eq for PriorityItem {}

impl PartialOrd for PriorityItem {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for PriorityItem {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .priority
            .cmp(&self.priority)
            .then_with(|| self.timestamp.cmp(&other.timestamp))
            .then_with(|| self.seq.cmp(&other.seq))
    }
}

#[derive(Debug)]
struct StreamQueue {
    queue: BinaryHeap<Reverse<PriorityItem>>,
    rate_limiter: Option<RateLimiter>,
    max_size: usize,
    current_size: usize,
    policy: QoSPolicy,
    enqueue_count: u64,
    dequeue_count: u64,
    drop_count: u64,
}

impl StreamQueue {
    fn new(policy: QoSPolicy) -> Self {
        let rate_limiter = policy
            .bandwidth_limit_bps
            .as_ref()
            .map(|&bps| RateLimiter::new(bps));

        Self {
            queue: BinaryHeap::new(),
            rate_limiter,
            max_size: policy.max_queue_size,
            current_size: 0,
            policy,
            enqueue_count: 0,
            dequeue_count: 0,
            drop_count: 0,
        }
    }

    fn enqueue(&mut self, data: Bytes, seq: u64) -> Result<(), QoSError> {
        let data_size = data.len();

        if self.current_size + data_size > self.max_size {
            self.drop_count += 1;
            return Err(QoSError::QueueFull(self.policy.stream_id));
        }

        let item = PriorityItem {
            priority: self.policy.priority,
            timestamp: Instant::now(),
            data,
            stream_id: self.policy.stream_id,
            seq,
        };

        self.queue.push(Reverse(item));
        self.current_size += data_size;
        self.enqueue_count += 1;

        Ok(())
    }

    fn dequeue(&mut self) -> Option<(StreamId, Bytes)> {
        let item = self.queue.pop()?;
        let data = item.0.data;
        self.current_size = self.current_size.saturating_sub(data.len());
        self.dequeue_count += 1;
        Some((item.0.stream_id, data))
    }

    fn try_dequeue_rate_limited(&mut self) -> Option<(StreamId, Bytes)> {
        if let Some(limiter) = &mut self.rate_limiter {
            if let Some(item) = self.queue.peek() {
                let data_len = item.0.data.len();
                if limiter.try_consume(data_len) {
                    return self.dequeue();
                }
            }
            None
        } else {
            self.dequeue()
        }
    }

    fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    fn len(&self) -> usize {
        self.queue.len()
    }
}

#[derive(Debug)]
pub struct QoSManager {
    stream_queues: HashMap<StreamId, RwLock<StreamQueue>>,
    global_seq: RwLock<u64>,
    total_enqueued: RwLock<u64>,
    total_dequeued: RwLock<u64>,
    total_dropped: RwLock<u64>,
}

impl QoSManager {
    pub fn new() -> Self {
        Self {
            stream_queues: HashMap::new(),
            global_seq: RwLock::new(0),
            total_enqueued: RwLock::new(0),
            total_dequeued: RwLock::new(0),
            total_dropped: RwLock::new(0),
        }
    }

    pub fn register_stream(&mut self, policy: QoSPolicy) {
        let stream_id = policy.stream_id;
        let queue = StreamQueue::new(policy);
        self.stream_queues.insert(stream_id, RwLock::new(queue));
        info!(stream_id = %stream_id, "Registered stream with QoS policy");
    }

    pub fn update_policy(&self, stream_id: StreamId, policy: QoSPolicy) -> Result<(), QoSError> {
        let queue = self
            .stream_queues
            .get(&stream_id)
            .ok_or(QoSError::StreamNotFound(stream_id))?;

        let mut q = queue.write();
        q.policy = policy.clone();
        q.max_size = policy.max_queue_size;
        q.rate_limiter = policy
            .bandwidth_limit_bps
            .as_ref()
            .map(|&bps| RateLimiter::new(bps));

        debug!(stream_id = %stream_id, "Updated QoS policy");
        Ok(())
    }

    pub fn remove_stream(&mut self, stream_id: StreamId) {
        self.stream_queues.remove(&stream_id);
        debug!(stream_id = %stream_id, "Removed stream QoS policy");
    }

    pub fn enqueue(
        &self,
        stream_id: StreamId,
        data: Bytes,
    ) -> Result<(), QoSError> {
        let queue = self
            .stream_queues
            .get(&stream_id)
            .ok_or(QoSError::StreamNotFound(stream_id))?;

        let seq = {
            let mut s = self.global_seq.write();
            *s += 1;
            *s
        };

        let result = queue.write().enqueue(data, seq);

        match &result {
            Ok(()) => {
                *self.total_enqueued.write() += 1;
            }
            Err(_) => {
                *self.total_dropped.write() += 1;
            }
        }

        result
    }

    pub fn dequeue(&self, stream_id: StreamId) -> Option<(StreamId, Bytes)> {
        let queue = self.stream_queues.get(&stream_id)?;
        let result = queue.write().try_dequeue_rate_limited();

        if result.is_some() {
            *self.total_dequeued.write() += 1;
        }

        result
    }

    pub fn dequeue_highest_priority(&self) -> Option<(StreamId, Bytes)> {
        let mut best_queue: Option<StreamId> = None;
        let mut best_priority: u8 = u8::MAX;
        let mut best_timestamp: Option<Instant> = None;

        for (&stream_id, queue) in &self.stream_queues {
            let q = queue.read();
            if let Some(item) = q.queue.peek() {
                let should_select = match best_timestamp {
                    None => true,
                    Some(best_ts) => {
                        item.0.priority < best_priority
                            || (item.0.priority == best_priority && item.0.timestamp < best_ts)
                    }
                };

                if should_select {
                    best_queue = Some(stream_id);
                    best_priority = item.0.priority;
                    best_timestamp = Some(item.0.timestamp);
                }
            }
        }

        if let Some(stream_id) = best_queue {
            self.dequeue(stream_id)
        } else {
            None
        }
    }

    pub fn dequeue_all_available(&self) -> Vec<(StreamId, Bytes)> {
        let mut results = Vec::new();

        for stream_id in self.stream_queues.keys() {
            while let Some(item) = self.dequeue(*stream_id) {
                results.push(item);
            }
        }

        results.sort_by(|a, b| {
            let qa = self.stream_queues.get(&a.0).unwrap().read();
            let qb = self.stream_queues.get(&b.0).unwrap().read();
            qb.policy.priority.cmp(&qa.policy.priority)
        });

        results
    }

    pub fn stream_priority(&self, stream_id: StreamId) -> Option<u8> {
        self.stream_queues
            .get(&stream_id)
            .map(|q| q.read().policy.priority)
    }

    pub fn stream_queue_len(&self, stream_id: StreamId) -> Option<usize> {
        self.stream_queues
            .get(&stream_id)
            .map(|q| q.read().len())
    }

    pub fn stream_drop_count(&self, stream_id: StreamId) -> Option<u64> {
        self.stream_queues
            .get(&stream_id)
            .map(|q| q.read().drop_count)
    }

    pub fn get_stats(&self) -> QoSStats {
        QoSStats {
            total_enqueued: *self.total_enqueued.read(),
            total_dequeued: *self.total_dequeued.read(),
            total_dropped: *self.total_dropped.read(),
            active_streams: self.stream_queues.len(),
            stream_stats: self
                .stream_queues
                .iter()
                .map(|(&id, q)| {
                    let q = q.read();
                    StreamQoSStats {
                        stream_id: id,
                        priority: q.policy.priority,
                        queue_size: q.len(),
                        enqueued: q.enqueue_count,
                        dequeued: q.dequeue_count,
                        dropped: q.drop_count,
                        bandwidth_limit_bps: q.policy.bandwidth_limit_bps,
                    }
                })
                .collect(),
        }
    }

    pub fn get_stream_stats(&self, stream_id: StreamId) -> Option<StreamQoSStats> {
        self.stream_queues.get(&stream_id).map(|q| {
            let q = q.read();
            StreamQoSStats {
                stream_id,
                priority: q.policy.priority,
                queue_size: q.len(),
                enqueued: q.enqueue_count,
                dequeued: q.dequeue_count,
                dropped: q.drop_count,
                bandwidth_limit_bps: q.policy.bandwidth_limit_bps,
            }
        })
    }
}

impl Default for QoSManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QoSStats {
    pub total_enqueued: u64,
    pub total_dequeued: u64,
    pub total_dropped: u64,
    pub active_streams: usize,
    pub stream_stats: Vec<StreamQoSStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamQoSStats {
    pub stream_id: StreamId,
    pub priority: u8,
    pub queue_size: usize,
    pub enqueued: u64,
    pub dequeued: u64,
    pub dropped: u64,
    pub bandwidth_limit_bps: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum QoSError {
    #[error("Stream {0} not registered with QoS")]
    StreamNotFound(StreamId),
    #[error("Queue full for stream {0}")]
    QueueFull(StreamId),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_ordering() {
        let item1 = PriorityItem {
            priority: 1,
            timestamp: Instant::now(),
            data: Bytes::from("low"),
            stream_id: 0,
            seq: 1,
        };

        let item2 = PriorityItem {
            priority: 10,
            timestamp: Instant::now(),
            data: Bytes::from("high"),
            stream_id: 1,
            seq: 2,
        };

        assert!(item2 > item1);
    }

    #[test]
    fn test_rate_limiter() {
        let mut limiter = RateLimiter::new(1000);
        assert!(limiter.try_consume(500));
        assert!(limiter.try_consume(500));
        assert!(!limiter.try_consume(500));
    }

    #[test]
    fn test_qos_enqueue_dequeue() {
        let mut manager = QoSManager::new();
        manager.register_stream(QoSPolicy {
            stream_id: 0,
            priority: 5,
            bandwidth_limit_bps: None,
            max_queue_size: 1024,
        });

        let data = Bytes::from_static(b"test");
        assert!(manager.enqueue(0, data.clone()).is_ok());

        let (sid, result) = manager.dequeue(0).unwrap();
        assert_eq!(sid, 0);
        assert_eq!(result, data);
    }

    #[test]
    fn test_queue_full() {
        let mut manager = QoSManager::new();
        manager.register_stream(QoSPolicy {
            stream_id: 0,
            priority: 5,
            bandwidth_limit_bps: None,
            max_queue_size: 5,
        });

        let data = Bytes::from_static(b"1234567890");
        assert!(manager.enqueue(0, data.clone()).is_ok());
        assert!(matches!(
            manager.enqueue(0, data),
            Err(QoSError::QueueFull(_))
        ));
    }
}
