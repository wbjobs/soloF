package com.fraud.ml;

import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.Pipeline;

import java.io.*;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public class SampleStore implements Serializable {
    private static final long serialVersionUID = 1L;

    private static final String LABELED_SAMPLES_KEY = "ml:labeled:samples";
    private static final String MODEL_KEY = "ml:model:current";
    private static final String MODEL_VERSION_KEY = "ml:model:version";
    private static final String TRAINING_QUEUE_KEY = "ml:training:queue";

    private transient JedisPool jedisPool;
    private String redisHost;
    private int redisPort;

    public SampleStore(String redisHost, int redisPort) {
        this.redisHost = redisHost;
        this.redisPort = redisPort;
        initPool();
    }

    private void initPool() {
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(8);
        poolConfig.setMaxIdle(4);
        poolConfig.setMinIdle(1);
        poolConfig.setTestOnBorrow(false);
        poolConfig.setTestOnReturn(false);
        poolConfig.setTestWhileIdle(true);
        jedisPool = new JedisPool(poolConfig, redisHost, redisPort, 2000);
    }

    private JedisPool getPool() {
        if (jedisPool == null || jedisPool.isClosed()) {
            initPool();
        }
        return jedisPool;
    }

    public void addLabeledSample(double[] features, boolean isAnomaly, String transactionId, String userId) {
        try (Jedis jedis = getPool().getResource()) {
            LabeledSample sample = new LabeledSample(features, isAnomaly);
            String sampleJson = serializeSample(sample, transactionId, userId);
            jedis.lpush(LABELED_SAMPLES_KEY, sampleJson);
            jedis.ltrim(LABELED_SAMPLES_KEY, 0, 9999);

            jedis.lpush(TRAINING_QUEUE_KEY, sampleJson);
        }
    }

    public List<LabeledSample> getNewSamplesForTraining(int maxCount) {
        List<LabeledSample> samples = new ArrayList<>();
        try (Jedis jedis = getPool().getResource()) {
            Pipeline pipeline = jedis.pipelined();
            for (int i = 0; i < maxCount; i++) {
                pipeline.rpop(TRAINING_QUEUE_KEY);
            }
            List<Object> results = pipeline.syncAndReturnAll();

            for (Object result : results) {
                if (result instanceof String) {
                    LabeledSample sample = deserializeSample((String) result);
                    if (sample != null) {
                        samples.add(sample);
                    }
                }
            }
        }
        return samples;
    }

    public List<LabeledSample> getAllLabeledSamples() {
        List<LabeledSample> samples = new ArrayList<>();
        try (Jedis jedis = getPool().getResource()) {
            List<String> sampleStrings = jedis.lrange(LABELED_SAMPLES_KEY, 0, -1);
            for (String sampleStr : sampleStrings) {
                LabeledSample sample = deserializeSample(sampleStr);
                if (sample != null) {
                    samples.add(sample);
                }
            }
        }
        return samples;
    }

    public void saveModel(IsolationForestModel model) {
        try (Jedis jedis = getPool().getResource()) {
            String modelStr = serializeModel(model);
            if (modelStr != null) {
                jedis.set(MODEL_KEY, modelStr);
                jedis.incr(MODEL_VERSION_KEY);
            }
        }
    }

    public IsolationForestModel loadModel() {
        try (Jedis jedis = getPool().getResource()) {
            String modelStr = jedis.get(MODEL_KEY);
            if (modelStr != null) {
                return deserializeModel(modelStr);
            }
        }
        return null;
    }

    public long getModelVersion() {
        try (Jedis jedis = getPool().getResource()) {
            String version = jedis.get(MODEL_VERSION_KEY);
            return version != null ? Long.parseLong(version) : 0;
        }
    }

    public long getLabeledSampleCount() {
        try (Jedis jedis = getPool().getResource()) {
            return jedis.llen(LABELED_SAMPLES_KEY);
        }
    }

    public int getTrainingQueueSize() {
        try (Jedis jedis = getPool().getResource()) {
            return (int) jedis.llen(TRAINING_QUEUE_KEY);
        }
    }

    public void clearTrainingQueue() {
        try (Jedis jedis = getPool().getResource()) {
            jedis.del(TRAINING_QUEUE_KEY);
        }
    }

    private String serializeSample(LabeledSample sample, String transactionId, String userId) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            DataOutputStream dos = new DataOutputStream(baos);

            dos.writeUTF(transactionId);
            dos.writeUTF(userId);
            dos.writeLong(sample.timestamp);
            dos.writeBoolean(sample.isAnomaly);
            dos.writeInt(sample.features.length);
            for (double v : sample.features) {
                dos.writeDouble(v);
            }

            dos.flush();
            return Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (Exception e) {
            return null;
        }
    }

    private LabeledSample deserializeSample(String data) {
        try {
            byte[] bytes = Base64.getDecoder().decode(data);
            ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
            DataInputStream dis = new DataInputStream(bais);

            String transactionId = dis.readUTF();
            String userId = dis.readUTF();
            long timestamp = dis.readLong();
            boolean isAnomaly = dis.readBoolean();
            int featureCount = dis.readInt();
            double[] features = new double[featureCount];
            for (int i = 0; i < featureCount; i++) {
                features[i] = dis.readDouble();
            }

            LabeledSample sample = new LabeledSample(features, isAnomaly);
            sample.timestamp = timestamp;
            return sample;
        } catch (Exception e) {
            return null;
        }
    }

    private String serializeModel(IsolationForestModel model) {
        try {
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ObjectOutputStream oos = new ObjectOutputStream(baos);
            oos.writeObject(model);
            oos.flush();
            return Base64.getEncoder().encodeToString(baos.toByteArray());
        } catch (Exception e) {
            return null;
        }
    }

    private IsolationForestModel deserializeModel(String data) {
        try {
            byte[] bytes = Base64.getDecoder().decode(data);
            ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
            ObjectInputStream ois = new ObjectInputStream(bais);
            return (IsolationForestModel) ois.readObject();
        } catch (Exception e) {
            return null;
        }
    }

    public void close() {
        if (jedisPool != null && !jedisPool.isClosed()) {
            jedisPool.close();
        }
    }

    public static class LabeledSample implements Serializable {
        private static final long serialVersionUID = 1L;

        public double[] features;
        public boolean isAnomaly;
        public long timestamp;

        public LabeledSample(double[] features, boolean isAnomaly) {
            this.features = features;
            this.isAnomaly = isAnomaly;
            this.timestamp = System.currentTimeMillis();
        }
    }
}
