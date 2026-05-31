package com.backend.service;

import com.backend.model.StatisticsData;
import com.backend.websocket.AlertWebSocketHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class WebSocketPushService {

    private static final Logger logger = LoggerFactory.getLogger(WebSocketPushService.class);

    private final RedisService redisService;
    private final AlertWebSocketHandler webSocketHandler;
    private final ObjectMapper objectMapper;

    public WebSocketPushService(RedisService redisService, AlertWebSocketHandler webSocketHandler) {
        this.redisService = redisService;
        this.webSocketHandler = webSocketHandler;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }

    @Scheduled(fixedRate = 5000)
    public void pushStatisticsData() {
        if (webSocketHandler.getActiveSessionCount() == 0) {
            return;
        }

        try {
            StatisticsData statistics = redisService.getStatisticsData();
            String json = objectMapper.writeValueAsString(statistics);
            webSocketHandler.broadcastMessage(json);
            logger.debug("Pushed statistics data to {} sessions", webSocketHandler.getActiveSessionCount());
        } catch (Exception e) {
            logger.error("Error pushing statistics data via WebSocket", e);
        }
    }
}
