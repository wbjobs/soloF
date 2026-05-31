package com.tsdb.downsampling;

import java.io.Serializable;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

public class DownsamplingRule implements Serializable {
    private static final long serialVersionUID = 1L;

    private String metricPattern;
    private long retentionThreshold;
    private long aggregationInterval;
    private AggregationFunction aggregationFunction;
    private boolean enabled;
    private boolean deleteOriginalData;

    public enum AggregationFunction {
        AVG,
        MAX,
        MIN,
        SUM,
        COUNT
    }

    public DownsamplingRule() {
        this.enabled = true;
        this.deleteOriginalData = true;
    }

    public DownsamplingRule(String metricPattern, long retentionThreshold, long aggregationInterval,
                            AggregationFunction aggregationFunction) {
        this.metricPattern = metricPattern;
        this.retentionThreshold = retentionThreshold;
        this.aggregationInterval = aggregationInterval;
        this.aggregationFunction = aggregationFunction;
        this.enabled = true;
        this.deleteOriginalData = true;
    }

    public static DownsamplingRule defaultRule() {
        return new DownsamplingRule(
                ".*",
                TimeUnit.DAYS.toMillis(7),
                TimeUnit.HOURS.toMillis(1),
                AggregationFunction.AVG
        );
    }

    public boolean matches(String metric) {
        if (metricPattern == null || metricPattern.equals(".*") || metricPattern.equals("*")) {
            return true;
        }
        return metric.matches(metricPattern);
    }

    public boolean shouldDownsample(long timestamp) {
        if (!enabled) {
            return false;
        }
        long cutoffTime = System.currentTimeMillis() - retentionThreshold;
        return timestamp < cutoffTime;
    }

    public long getBucketStart(long timestamp) {
        return (timestamp / aggregationInterval) * aggregationInterval;
    }

    public String getMetricPattern() {
        return metricPattern;
    }

    public void setMetricPattern(String metricPattern) {
        this.metricPattern = metricPattern;
    }

    public long getRetentionThreshold() {
        return retentionThreshold;
    }

    public void setRetentionThreshold(long retentionThreshold) {
        this.retentionThreshold = retentionThreshold;
    }

    public long getAggregationInterval() {
        return aggregationInterval;
    }

    public void setAggregationInterval(long aggregationInterval) {
        this.aggregationInterval = aggregationInterval;
    }

    public AggregationFunction getAggregationFunction() {
        return aggregationFunction;
    }

    public void setAggregationFunction(AggregationFunction aggregationFunction) {
        this.aggregationFunction = aggregationFunction;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isDeleteOriginalData() {
        return deleteOriginalData;
    }

    public void setDeleteOriginalData(boolean deleteOriginalData) {
        this.deleteOriginalData = deleteOriginalData;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        DownsamplingRule that = (DownsamplingRule) o;
        return retentionThreshold == that.retentionThreshold &&
                aggregationInterval == that.aggregationInterval &&
                enabled == that.enabled &&
                deleteOriginalData == that.deleteOriginalData &&
                Objects.equals(metricPattern, that.metricPattern) &&
                aggregationFunction == that.aggregationFunction;
    }

    @Override
    public int hashCode() {
        return Objects.hash(metricPattern, retentionThreshold, aggregationInterval, aggregationFunction, enabled, deleteOriginalData);
    }

    @Override
    public String toString() {
        return "DownsamplingRule{" +
                "metricPattern='" + metricPattern + '\'' +
                ", retentionThreshold=" + retentionThreshold +
                ", aggregationInterval=" + aggregationInterval +
                ", aggregationFunction=" + aggregationFunction +
                ", enabled=" + enabled +
                ", deleteOriginalData=" + deleteOriginalData +
                '}';
    }
}
