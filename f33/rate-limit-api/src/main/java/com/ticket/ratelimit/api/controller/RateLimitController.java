package com.ticket.ratelimit.api.controller;

import com.ticket.ratelimit.api.dto.RateLimitRequest;
import com.ticket.ratelimit.api.dto.RateLimitResponse;
import com.ticket.ratelimit.redis.service.TokenBucketService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rate-limit")
@RequiredArgsConstructor
public class RateLimitController {

    private final TokenBucketService tokenBucketService;

    @PostMapping("/acquire")
    public ResponseEntity<RateLimitResponse> acquire(@Valid @RequestBody RateLimitRequest request) {
        TokenBucketService.RateLimitResult result = tokenBucketService.tryAcquire(
                request.getEventId(),
                request.getUserId()
        );

        RateLimitResponse response;
        if (result.isFallback()) {
            response = RateLimitResponse.fallback();
        } else if (result.isAllowed()) {
            response = RateLimitResponse.pass();
        } else {
            response = RateLimitResponse.queue();
        }

        return ResponseEntity.ok(response);
    }
}
