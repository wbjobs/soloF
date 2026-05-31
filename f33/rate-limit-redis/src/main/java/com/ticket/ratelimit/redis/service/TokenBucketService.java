package com.ticket.ratelimit.redis.service;

import io.github.resilience4j.bulkhead.annotation.Bulkhead;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.timelimiter.annotation.TimeLimiter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@Slf4j
@Service
@RequiredArgsConstructor
public class TokenBucketService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final DefaultRedisScript<Long> tokenBucketScript;

    private static final String TOKEN_BUCKET_PREFIX = "token:bucket:";
    private static final String QUEUE_STREAM_PREFIX = "queue:stream:";
    private static final long PASS = 1L;
    private static final long QUEUE = 0L;
    private static final String CB_NAME = "redisRateLimit";

    @CircuitBreaker(name = CB_NAME, fallbackMethod = "fallbackAcquire")
    @Bulkhead(name = CB_NAME, fallbackMethod = "fallbackAcquire")
    public RateLimitResult tryAcquire(String eventId, String userId) {
        try {
            String bucketKey = TOKEN_BUCKET_PREFIX + eventId;
            String streamKey = QUEUE_STREAM_PREFIX + eventId;

            Long result = redisTemplate.execute(
                    tokenBucketScript,
                    Collections.singletonList(bucketKey),
                    100L,
                    10L,
                    System.currentTimeMillis(),
                    streamKey,
                    userId
            );

            if (result == null) {
                return RateLimitResult.queue();
            }

            return result == PASS ? RateLimitResult.pass() : RateLimitResult.queue();
        } catch (Exception e) {
            log.warn("Redis操作异常: eventId={}, userId={}, error={}", eventId, userId, e.getMessage());
            return RateLimitResult.fallback();
        }
    }

    public RateLimitResult fallbackAcquire(String eventId, String userId, Exception e) {
        log.warn("熔断降级触发: eventId={}, userId={}, cause={}", eventId, userId, e.getClass().getSimpleName());
        return RateLimitResult.fallback();
    }

    @TimeLimiter(name = CB_NAME, fallbackMethod = "fallbackAcquire")
    public CompletableFuture<RateLimitResult> tryAcquireAsync(String eventId, String userId) {
        return CompletableFuture.supplyAsync(() -> tryAcquire(eventId, userId));
    }

    public static class RateLimitResult {
        private final boolean allowed;
        private final String status;
        private final boolean fallback;

        private RateLimitResult(boolean allowed, String status) {
            this(allowed, status, false);
        }

        private RateLimitResult(boolean allowed, String status, boolean fallback) {
            this.allowed = allowed;
            this.status = status;
            this.fallback = fallback;
        }

        public static RateLimitResult pass() {
            return new RateLimitResult(true, "通行");
        }

        public static RateLimitResult queue() {
            return new RateLimitResult(false, "排队中");
        }

        public static RateLimitResult fallback() {
            return new RateLimitResult(false, "系统繁忙", true);
        }

        public boolean isAllowed() {
            return allowed;
        }

        public String getStatus() {
            return status;
        }

        public boolean isFallback() {
            return fallback;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> map = new HashMap<>();
            map.put("allowed", allowed);
            map.put("status", status);
            map.put("fallback", fallback);
            return map;
        }
    }
}
