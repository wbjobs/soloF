package com.ticket.ratelimit.redis.config;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.circuitbreaker.event.CircuitBreakerOnStateTransitionEvent;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;

@Slf4j
@Configuration
@RequiredArgsConstructor
public class Resilience4jConfig {

    private final CircuitBreakerRegistry circuitBreakerRegistry;

    @PostConstruct
    public void configureCircuitBreakerListener() {
        CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker("redisRateLimit");
        
        circuitBreaker.getEventPublisher()
                .onStateTransition(this::onStateTransition)
                .onError(event -> log.warn("熔断错误事件: {}, 异常: {}", 
                        event.getCircuitBreakerName(), 
                        event.getThrowable().getMessage()))
                .onSuccess(event -> log.debug("熔断成功事件: {}", 
                        event.getCircuitBreakerName()))
                .onCallNotPermitted(event -> log.warn("熔断触发 - 调用不允许: {}", 
                        event.getCircuitBreakerName()));
    }

    private void onStateTransition(CircuitBreakerOnStateTransitionEvent event) {
        CircuitBreaker.State fromState = event.getStateTransition().getFromState();
        CircuitBreaker.State toState = event.getStateTransition().getToState();
        
        log.info("熔断器状态变更: {} -> {} [{}]", 
                fromState, 
                toState, 
                event.getCircuitBreakerName());
        
        if (toState == CircuitBreaker.State.OPEN) {
            log.error("熔断器已打开，Redis服务可能异常");
        } else if (toState == CircuitBreaker.State.HALF_OPEN) {
            log.warn("熔断器进入半开状态，开始探测服务恢复情况");
        } else if (toState == CircuitBreaker.State.CLOSED) {
            log.info("熔断器已关闭，服务恢复正常");
        }
    }
}
