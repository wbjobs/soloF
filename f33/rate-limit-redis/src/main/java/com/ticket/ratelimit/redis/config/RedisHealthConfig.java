package com.ticket.ratelimit.redis.config;

import io.lettuce.core.RedisConnectionException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class RedisHealthConfig implements HealthIndicator {

    private final RedisTemplate<String, Object> redisTemplate;

    @Override
    public Health health() {
        try {
            RedisConnection connection = redisTemplate.getConnectionFactory().getConnection();
            String pong = connection.ping();
            connection.close();
            
            return Health.up()
                    .withDetail("redis", "可达")
                    .withDetail("ping", pong)
                    .build();
        } catch (RedisConnectionException e) {
            log.error("Redis健康检查失败: {}", e.getMessage());
            return Health.down()
                    .withDetail("redis", "不可达")
                    .withDetail("error", e.getMessage())
                    .build();
        } catch (Exception e) {
            log.error("Redis健康检查异常: {}", e.getMessage());
            return Health.down()
                    .withDetail("redis", "异常")
                    .withDetail("error", e.getMessage())
                    .build();
        }
    }
}
