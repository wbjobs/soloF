package com.tsdb.model;

import java.io.Serializable;
import java.util.Objects;

public class DataPoint implements Serializable, Comparable<DataPoint> {
    private static final long serialVersionUID = 1L;

    private final String metric;
    private final Tags tags;
    private final long timestamp;
    private final double value;

    public DataPoint(String metric, Tags tags, long timestamp, double value) {
        this.metric = metric;
        this.tags = tags;
        this.timestamp = timestamp;
        this.value = value;
    }

    public String getMetric() {
        return metric;
    }

    public Tags getTags() {
        return tags;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public double getValue() {
        return value;
    }

    public String getSeriesKey() {
        return metric + tags.getHashKey();
    }

    @Override
    public int compareTo(DataPoint other) {
        int keyCompare = this.getSeriesKey().compareTo(other.getSeriesKey());
        if (keyCompare != 0) {
            return keyCompare;
        }
        return Long.compare(this.timestamp, other.timestamp);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        DataPoint dataPoint = (DataPoint) o;
        return timestamp == dataPoint.timestamp &&
                Double.compare(dataPoint.value, value) == 0 &&
                Objects.equals(metric, dataPoint.metric) &&
                Objects.equals(tags, dataPoint.tags);
    }

    @Override
    public int hashCode() {
        return Objects.hash(metric, tags, timestamp, value);
    }

    @Override
    public String toString() {
        return "DataPoint{" +
                "metric='" + metric + '\'' +
                ", tags=" + tags +
                ", timestamp=" + timestamp +
                ", value=" + value +
                '}';
    }
}
