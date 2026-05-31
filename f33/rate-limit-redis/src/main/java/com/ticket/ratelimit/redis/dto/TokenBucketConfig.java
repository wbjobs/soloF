package com.ticket.ratelimit.redis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TokenBucketConfig implements Serializable {

    private String eventId;

    private Long capacity;

    private Long rate;

    private Long updatedAt;

    private String updatedBy;
}
