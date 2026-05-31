package com.backend.controller;

import com.backend.model.Alert;
import com.backend.model.StatisticsData;
import com.backend.service.RedisService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class AlertController {

    private final RedisService redisService;

    public AlertController(RedisService redisService) {
        this.redisService = redisService;
    }

    @GetMapping("/statistics")
    public ResponseEntity<StatisticsData> getStatistics() {
        try {
            StatisticsData data = redisService.getStatisticsData();
            return ResponseEntity.ok(data);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/alerts/recent")
    public ResponseEntity<List<Alert>> getRecentAlerts(@RequestParam(defaultValue = "20") int count) {
        try {
            List<Alert> alerts = redisService.getRecentAlerts(count);
            return ResponseEntity.ok(alerts);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/alerts/top-users")
    public ResponseEntity<List<Map<String, Object>>> getTopUsers(@RequestParam(defaultValue = "10") int limit) {
        try {
            List<Map<String, Object>> topUsers = redisService.getTopUsers(limit);
            return ResponseEntity.ok(topUsers);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/alerts/rate-history")
    public ResponseEntity<List<Map<String, Object>>> getAlertRateHistory(@RequestParam(defaultValue = "30") int minutes) {
        try {
            List<Map<String, Object>> history = redisService.getAlertRateHistory(minutes);
            return ResponseEntity.ok(history);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/users/{userId}/alerts")
    public ResponseEntity<List<Alert>> getUserAlerts(@PathVariable String userId, @RequestParam(defaultValue = "10") int count) {
        try {
            List<Alert> alerts = redisService.getUserAlerts(userId, count);
            return ResponseEntity.ok(alerts);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> health = new HashMap<>();
        health.put("status", "UP");
        health.put("totalAlerts", redisService.getTotalAlerts());
        return ResponseEntity.ok(health);
    }
}
