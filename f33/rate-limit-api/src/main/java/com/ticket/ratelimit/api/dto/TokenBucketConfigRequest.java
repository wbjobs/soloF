package com.ticket.ratelimit.api.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class TokenBucketConfigRequest {

    @NotBlank(message = "eventId不能为空")
    private String eventId;

    @Min(value = 1, message = "桶容量必须大于0")
    private Long capacity;

    @Min(value = 1, message = "令牌生成速率必须大于0")
    private Long rate;

    private String operator;
}
