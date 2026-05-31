package com.backend.service;

import com.backend.model.Alert;
import com.backend.model.StatisticsData;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
public class RedisService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String RECENT_ALERTS_KEY = "alerts:recent";
    private static final String USER_ALERT_COUNT_KEY = "user:alert:count";
    private static final String ALERT_RATE_PREFIX = "alert:rate:";
    private static final String TRANSACTION_COUNT_PREFIX = "transaction:count:";
    private static final String ALERT_TOTAL_KEY = "alert:total";
    private static final String USER_ALERTS_PREFIX = "user:alerts:";
    private static final String ALERT_TYPE_PREFIX = "alert:type:";

    public RedisService(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }

    public long getTotalAlerts() {
        Object value = redisTemplate.opsForValue().get(ALERT_TOTAL_KEY);
        return value != null ? Long.parseLong(value.toString()) : 0;
    }

    public List<Alert> getRecentAlerts(int count) {
        List<Object> rawAlerts = redisTemplate.opsForList().range(RECENT_ALERTS_KEY, 0, count - 1);
        List<Alert> alerts = new ArrayList<>();

        if (rawAlerts != null) {
            for (Object raw : rawAlerts) {
                try {
                    Alert alert = objectMapper.convertValue(raw, Alert.class);
                    if (alert == null && raw instanceof String) {
                        alert = objectMapper.readValue((String) raw, Alert.class);
                    }
                    if (alert != null) {
                        alerts.add(alert);
                    }
                } catch (Exception e) {
                }
            }
        }
        return alerts;
    }

    public List<Map<String, Object>> getTopUsers(int limit) {
        Set<org.springframework.data.redis.core.ZSetOperations.TypedTuple<Object>> tuples =
                redisTemplate.opsForZSet().reverseRangeWithScores(USER_ALERT_COUNT_KEY, 0, limit - 1);

        List<Map<String, Object>> topUsers = new ArrayList<>();
        if (tuples != null) {
            for (org.springframework.data.redis.core.ZSetOperations.TypedTuple<Object> tuple : tuples) {
                Map<String, Object> userData = new HashMap<>();
                userData.put("userId", tuple.getValue());
                userData.put("alertCount", tuple.getScore().intValue());
                topUsers.add(userData);
            }
        }
        return topUsers;
    }

    public List<Map<String, Object>> getAlertRateHistory(int minutes) {
        List<Map<String, Object>> history = new ArrayList<>();
        long currentTime = System.currentTimeMillis() / 60000;

        for (int i = minutes - 1; i >= 0; i--) {
            long timeKey = currentTime - i;
            String alertKey = ALERT_RATE_PREFIX + timeKey;
            String transactionKey = TRANSACTION_COUNT_PREFIX + timeKey;

            Object alertCountObj = redisTemplate.opsForValue().get(alertKey);
            Object transactionCountObj = redisTemplate.opsForValue().get(transactionKey);

            long alertCount = alertCountObj != null ? Long.parseLong(alertCountObj.toString()) : 0;
            long transactionCount = transactionCountObj != null ? Long.parseLong(transactionCountObj.toString()) : 0;

            double rate = transactionCount > 0 ? (double) alertCount / transactionCount * 100 : 0;

            Map<String, Object> dataPoint = new HashMap<>();
            LocalDateTime time = LocalDateTime.ofInstant(
                    Instant.ofEpochMilli(timeKey * 60000),
                    ZoneId.systemDefault()
            );
            dataPoint.put("time", time.toString());
            dataPoint.put("alertCount", alertCount);
            dataPoint.put("transactionCount", transactionCount);
            dataPoint.put("alertRate", Math.round(rate * 100.0) / 100.0);

            history.add(dataPoint);
        }
        return history;
    }

    public Map<String, Long> getAlertTypeDistribution() {
        Map<String, Long> distribution = new HashMap<>();
        String[] types = {"HIGH_FREQUENCY", "SUDDEN_AMOUNT_INCREASE", "CROSS_REGION_LOGIN", "ML_ANOMALY"};

        for (String type : types) {
            String key = ALERT_TYPE_PREFIX + type;
            Object value = redisTemplate.opsForValue().get(key);
            distribution.put(type, value != null ? Long.parseLong(value.toString()) : 0);
        }
        return distribution;
    }

    public StatisticsData getStatisticsData() {
        StatisticsData data = new StatisticsData();
        data.setTotalAlerts(getTotalAlerts());
        data.setAlertRateHistory(getAlertRateHistory(30));
        data.setTopUsers(getTopUsers(10));
        data.setRecentAlerts(getRecentAlerts(20));
        data.setAlertTypeDistribution(getAlertTypeDistribution());
        return data;
    }

    public List<Alert> getUserAlerts(String userId, int count) {
        String key = USER_ALERTS_PREFIX + userId;
        List<Object> rawAlerts = redisTemplate.opsForList().range(key, 0, count - 1);
        List<Alert> alerts = new ArrayList<>();

        if (rawAlerts != null) {
            for (Object raw : rawAlerts) {
                try {
                    Alert alert = objectMapper.convertValue(raw, Alert.class);
                    if (alert == null && raw instanceof String) {
                        alert = objectMapper.readValue((String) raw, Alert.class);
                    }
                    if (alert != null) {
                        alerts.add(alert);
                    }
                } catch (Exception e) {
                }
            }
        }
        return alerts;
    }
}
