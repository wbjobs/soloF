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
public class Transaction {
    @JsonProperty("transactionId")
    private String transactionId;

    @JsonProperty("userId")
    private String userId;

    @JsonProperty("amount")
    private double amount;

    @JsonProperty("city")
    private String city;

    @JsonProperty("timestamp")
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss")
    private LocalDateTime timestamp;

    @JsonProperty("merchant")
    private String merchant;

    @JsonProperty("paymentMethod")
    private String paymentMethod;
}
