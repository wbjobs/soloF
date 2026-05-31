package com.backend.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class StatisticsData {
    @JsonProperty("totalAlerts")
    private long totalAlerts;

    @JsonProperty("alertRateHistory")
    private List<Map<String, Object>> alertRateHistory;

    @JsonProperty("topUsers")
    private List<Map<String, Object>> topUsers;

    @JsonProperty("recentAlerts")
    private List<Alert> recentAlerts;

    @JsonProperty("alertTypeDistribution")
    private Map<String, Long> alertTypeDistribution;
}
