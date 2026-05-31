package com.ticket.ratelimit.api.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class RateLimitResponse {

    private boolean allowed;
    private String status;
    private String message;
    private boolean fallback;

    public static RateLimitResponse pass() {
        return new RateLimitResponse(true, "通行", "请求已通过限流检查", false);
    }

    public static RateLimitResponse queue() {
        return new RateLimitResponse(false, "排队中", "令牌不足，已进入排队队列", false);
    }

    public static RateLimitResponse fallback() {
        return new RateLimitResponse(false, "系统繁忙", "服务保护机制触发，请稍后重试", true);
    }
}
