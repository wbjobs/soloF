package com.ticket.ratelimit.api.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RateLimitRequest {

    @NotBlank(message = "event_id不能为空")
    private String eventId;

    @NotBlank(message = "user_id不能为空")
    private String userId;
}
