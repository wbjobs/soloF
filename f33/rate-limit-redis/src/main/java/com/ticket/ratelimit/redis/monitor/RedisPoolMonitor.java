package com.ticket.ratelimit.redis.monitor;

import io.lettuce.core.support.BoundedPoolConfig;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.endpoint.annotation.Endpoint;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Component
@Endpoint(id = "redis-pool")
@RequiredArgsConstructor
public class RedisPoolMonitor {

    private final LettuceConnectionFactory lettuceConnectionFactory;

    @PostConstruct
    public void init() {
        log.info("Redis连接池监控初始化完成");
    }

    @ReadOperation
    public Map<String, Object> getPoolStats() {
        Map<String, Object> stats = new HashMap<>();
        
        try {
            BoundedPoolConfig poolConfig = lettuceConnectionFactory.getPoolConfig();
            if (poolConfig != null) {
                stats.put("maxTotal", poolConfig.getMaxTotal());
                stats.put("maxIdle", poolConfig.getMaxIdle());
                stats.put("minIdle", poolConfig.getMinIdle());
            }
            
            stats.put("database", lettuceConnectionFactory.getDatabase());
            stats.put("hostName", lettuceConnectionFactory.getHostName());
            stats.put("port", lettuceConnectionFactory.getPort());
            
        } catch (Exception e) {
            log.warn("获取Redis连接池统计失败: {}", e.getMessage());
            stats.put("error", e.getMessage());
        }
        
        return stats;
    }
}
