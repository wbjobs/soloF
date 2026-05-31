package com.fraud.sink;

import com.fraud.model.Alert;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.sink.RichSinkFunction;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.Pipeline;

import java.util.ArrayList;
import java.util.List;

public class RedisAlertSink extends RichSinkFunction<Alert> {

    private final String redisHost;
    private final int redisPort;
    private transient JedisPool jedisPool;
    private transient ObjectMapper objectMapper;
    private transient List<Alert> batchBuffer;
    private static final int BATCH_SIZE = 50;
    private static final long FLUSH_INTERVAL_MS = 1000L;
    private transient long lastFlushTime;

    public RedisAlertSink(String redisHost, int redisPort) {
        this.redisHost = redisHost;
        this.redisPort = redisPort;
    }

    @Override
    public void open(Configuration parameters) {
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(16);
        poolConfig.setMaxIdle(8);
        poolConfig.setMinIdle(2);
        poolConfig.setTestOnBorrow(false);
        poolConfig.setTestOnReturn(false);
        poolConfig.setTestWhileIdle(true);
        poolConfig.setBlockWhenExhausted(true);
        poolConfig.setMaxWaitMillis(5000);
        jedisPool = new JedisPool(poolConfig, redisHost, redisPort, 2000);

        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());

        batchBuffer = new ArrayList<>(BATCH_SIZE);
        lastFlushTime = System.currentTimeMillis();
    }

    @Override
    public void invoke(Alert alert, Context context) throws Exception {
        synchronized (batchBuffer) {
            batchBuffer.add(alert);

            long currentTime = System.currentTimeMillis();
            if (batchBuffer.size() >= BATCH_SIZE || (currentTime - lastFlushTime) >= FLUSH_INTERVAL_MS) {
                flush();
            }
        }
    }

    private void flush() {
        if (batchBuffer.isEmpty()) {
            return;
        }

        List<Alert> alertsToFlush = new ArrayList<>(batchBuffer);
        batchBuffer.clear();
        lastFlushTime = System.currentTimeMillis();

        try (Jedis jedis = jedisPool.getResource()) {
            Pipeline pipeline = jedis.pipelined();

            long currentMinuteKey = System.currentTimeMillis() / 60000;

            for (Alert alert : alertsToFlush) {
                try {
                    String alertJson = objectMapper.writeValueAsString(alert);

                    String alertKey = "alert:" + alert.getAlertId();
                    pipeline.setex(alertKey, 3600, alertJson);

                    String userAlertsKey = "user:alerts:" + alert.getUserId();
                    pipeline.lpush(userAlertsKey, alertJson);
                    pipeline.ltrim(userAlertsKey, 0, 99);
                    pipeline.expire(userAlertsKey, 3600);

                    String typeKey = "alert:type:" + alert.getAlertType();
                    pipeline.incr(typeKey);
                    pipeline.expire(typeKey, 86400);

                    String alertsKey = "alerts:recent";
                    pipeline.lpush(alertsKey, alertJson);
                    pipeline.ltrim(alertsKey, 0, 999);

                    String userScoreKey = "user:alert:count";
                    pipeline.zincrby(userScoreKey, 1, alert.getUserId());

                    String rateKey = "alert:rate:" + currentMinuteKey;
                    pipeline.incr(rateKey);
                    pipeline.expire(rateKey, 3600);

                    String totalKey = "alert:total";
                    pipeline.incr(totalKey);

                    String transactionCountKey = "transaction:count:" + currentMinuteKey;
                    pipeline.incr(transactionCountKey);
                    pipeline.expire(transactionCountKey, 3600);
                } catch (Exception e) {
                }
            }

            pipeline.sync();
        } catch (Exception e) {
        }
    }

    @Override
    public void finish() {
        flush();
    }

    @Override
    public void close() {
        flush();
        if (jedisPool != null && !jedisPool.isClosed()) {
            jedisPool.close();
        }
    }
}
