package com.fraud.model;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class Alert {
    @JsonProperty("alertId")
    private String alertId;

    @JsonProperty("userId")
    private String userId;

    @JsonProperty("alertType")
    private String alertType;

    @JsonProperty("alertMessage")
    private String alertMessage;

    @JsonProperty("severity")
    private String severity;

    @JsonProperty("transactionId")
    private String transactionId;

    @JsonProperty("timestamp")
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;

    @JsonProperty("details")
    private String details;
}
