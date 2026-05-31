package com.ticket.ratelimit.api.controller;

import com.ticket.ratelimit.api.dto.TokenBucketConfigRequest;
import com.ticket.ratelimit.redis.dto.TokenBucketConfig;
import com.ticket.ratelimit.redis.service.TokenBucketConfigService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/admin/rate-limit")
@RequiredArgsConstructor
public class TokenBucketAdminController {

    private final TokenBucketConfigService configService;

    @PutMapping("/config")
    public ResponseEntity<Map<String, Object>> updateConfig(
            @Valid @RequestBody TokenBucketConfigRequest request) {

        if (request.getCapacity() == null && request.getRate() == null) {
            Map<String, Object> error = new HashMap<>();
            error.put("success", false);
            error.put("message", "capacity和rate至少提供一个参数");
            return ResponseEntity.badRequest().body(error);
        }

        boolean success = configService.updateConfig(
                request.getEventId(),
                request.getCapacity(),
                request.getRate(),
                request.getOperator()
        );

        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("message", success ? "配置更新成功" : "配置更新失败");
        response.put("data", configService.getConfig(request.getEventId()));

        return ResponseEntity.ok(response);
    }

    @GetMapping("/config/{eventId}")
    public ResponseEntity<Map<String, Object>> getConfig(@PathVariable String eventId) {
        TokenBucketConfig config = configService.getConfig(eventId);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", config);

        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/config/{eventId}")
    public ResponseEntity<Map<String, Object>> deleteConfig(
            @PathVariable String eventId,
            @RequestParam(required = false) String operator) {

        boolean success = configService.deleteConfig(eventId, operator);

        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("message", success ? "配置已删除，恢复默认值" : "配置删除失败");

        return ResponseEntity.ok(response);
    }

    @GetMapping("/configs")
    public ResponseEntity<Map<String, Object>> getAllConfiguredEvents() {
        Set<String> eventIds = configService.getAllConfiguredEventIds();

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", eventIds);
        response.put("total", eventIds.size());

        return ResponseEntity.ok(response);
    }

    @PostMapping("/reset/{eventId}")
    public ResponseEntity<Map<String, Object>> resetBucket(@PathVariable String eventId) {
        boolean success = configService.resetBucket(eventId);

        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("message", success ? "令牌桶已重置" : "令牌桶重置失败");

        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats/{eventId}")
    public ResponseEntity<Map<String, Object>> getBucketStats(@PathVariable String eventId) {
        Map<String, Object> stats = configService.getBucketStats(eventId);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", stats);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/expand/{eventId}")
    public ResponseEntity<Map<String, Object>> expandCapacity(
            @PathVariable String eventId,
            @RequestParam(defaultValue = "2") Integer times,
            @RequestParam(required = false) String operator) {

        TokenBucketConfig currentConfig = configService.getConfig(eventId);
        Long newCapacity = currentConfig.getCapacity() * times;
        Long newRate = currentConfig.getRate() * times;

        boolean success = configService.updateConfig(eventId, newCapacity, newRate, operator);

        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("message", success ? "动态扩容成功" : "动态扩容失败");
        response.put("oldCapacity", currentConfig.getCapacity());
        response.put("newCapacity", newCapacity);
        response.put("oldRate", currentConfig.getRate());
        response.put("newRate", newRate);
        response.put("expandTimes", times);

        return ResponseEntity.ok(response);
    }
}
