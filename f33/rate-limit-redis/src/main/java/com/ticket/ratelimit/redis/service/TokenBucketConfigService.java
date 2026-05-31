package com.ticket.ratelimit.redis.service;

import com.ticket.ratelimit.redis.dto.TokenBucketConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class TokenBucketConfigService {

    private final RedisTemplate<String, Object> redisTemplate;

    private static final String TOKEN_BUCKET_PREFIX = "token:bucket:";
    private static final String CONFIG_SUFFIX = ":config";
    private static final long DEFAULT_CAPACITY = 100L;
    private static final long DEFAULT_RATE = 10L;

    public boolean updateConfig(String eventId, Long capacity, Long rate, String operator) {
        String configKey = TOKEN_BUCKET_PREFIX + eventId + CONFIG_SUFFIX;

        Map<String, Object> config = new HashMap<>();
        if (capacity != null && capacity > 0) {
            config.put("capacity", capacity);
        }
        if (rate != null && rate > 0) {
            config.put("rate", rate);
        }
        config.put("updatedAt", System.currentTimeMillis());
        if (operator != null) {
            config.put("updatedBy", operator);
        }

        try {
            redisTemplate.opsForHash().putAll(configKey, config);
            redisTemplate.expire(configKey, 7, TimeUnit.DAYS);

            log.info("令牌桶配置更新成功: eventId={}, capacity={}, rate={}, operator={}",
                    eventId, capacity, rate, operator);
            return true;
        } catch (Exception e) {
            log.error("令牌桶配置更新失败: eventId={}", eventId, e);
            return false;
        }
    }

    public TokenBucketConfig getConfig(String eventId) {
        String configKey = TOKEN_BUCKET_PREFIX + eventId + CONFIG_SUFFIX;

        Map<Object, Object> configMap = redisTemplate.opsForHash().entries(configKey);
        if (configMap.isEmpty()) {
            return createDefaultConfig(eventId);
        }

        TokenBucketConfig config = new TokenBucketConfig();
        config.setEventId(eventId);
        config.setCapacity(configMap.containsKey("capacity")
                ? Long.parseLong(configMap.get("capacity").toString())
                : DEFAULT_CAPACITY);
        config.setRate(configMap.containsKey("rate")
                ? Long.parseLong(configMap.get("rate").toString())
                : DEFAULT_RATE);
        config.setUpdatedAt(configMap.containsKey("updatedAt")
                ? Long.parseLong(configMap.get("updatedAt").toString())
                : null);
        config.setUpdatedBy(configMap.containsKey("updatedBy")
                ? (String) configMap.get("updatedBy")
                : null);

        return config;
    }

    public boolean deleteConfig(String eventId, String operator) {
        String configKey = TOKEN_BUCKET_PREFIX + eventId + CONFIG_SUFFIX;
        try {
            Boolean deleted = redisTemplate.delete(configKey);
            log.info("令牌桶配置删除: eventId={}, operator={}, result={}", eventId, operator, deleted);
            return Boolean.TRUE.equals(deleted);
        } catch (Exception e) {
            log.error("令牌桶配置删除失败: eventId={}", eventId, e);
            return false;
        }
    }

    public Set<String> getAllConfiguredEventIds() {
        String pattern = TOKEN_BUCKET_PREFIX + "*" + CONFIG_SUFFIX;
        Set<String> keys = redisTemplate.keys(pattern);
        if (keys == null) {
            return Set.of();
        }
        return keys.stream()
                .map(key -> key.substring(TOKEN_BUCKET_PREFIX.length(), key.length() - CONFIG_SUFFIX.length()))
                .collect(Collectors.toSet());
    }

    public boolean resetBucket(String eventId) {
        String bucketKey = TOKEN_BUCKET_PREFIX + eventId;
        String tokensKey = bucketKey + ":tokens";
        String lastRefillKey = bucketKey + ":last_refill";

        try {
            redisTemplate.delete(tokensKey);
            redisTemplate.delete(lastRefillKey);
            log.info("令牌桶重置成功: eventId={}", eventId);
            return true;
        } catch (Exception e) {
            log.error("令牌桶重置失败: eventId={}", eventId, e);
            return false;
        }
    }

    public Map<String, Object> getBucketStats(String eventId) {
        String bucketKey = TOKEN_BUCKET_PREFIX + eventId;
        String tokensKey = bucketKey + ":tokens";
        String lastRefillKey = bucketKey + ":last_refill";

        Map<String, Object> stats = new HashMap<>();
        stats.put("eventId", eventId);

        Object tokens = redisTemplate.opsForValue().get(tokensKey);
        Object lastRefill = redisTemplate.opsForValue().get(lastRefillKey);

        stats.put("currentTokens", tokens != null ? Long.parseLong(tokens.toString()) : 0);
        stats.put("lastRefillTime", lastRefill != null ? Long.parseLong(lastRefill.toString()) : 0);

        TokenBucketConfig config = getConfig(eventId);
        stats.put("capacity", config.getCapacity());
        stats.put("rate", config.getRate());

        return stats;
    }

    private TokenBucketConfig createDefaultConfig(String eventId) {
        TokenBucketConfig config = new TokenBucketConfig();
        config.setEventId(eventId);
        config.setCapacity(DEFAULT_CAPACITY);
        config.setRate(DEFAULT_RATE);
        return config;
    }
}
