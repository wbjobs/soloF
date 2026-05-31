package com.tsdb.downsampling;

import com.tsdb.engine.LSMEngine;
import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

public class DownsamplingEngine implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(DownsamplingEngine.class);

    private final LSMEngine engine;
    private final List<DownsamplingRule> rules;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private Thread downsamplingThread;

    private final AtomicLong totalDownsampledPoints = new AtomicLong(0);
    private final AtomicLong totalAggregatedPoints = new AtomicLong(0);
    private final AtomicLong lastRunTime = new AtomicLong(0);
    private final AtomicLong downsamplingCount = new AtomicLong(0);

    public DownsamplingEngine(LSMEngine engine) {
        this.engine = engine;
        this.rules = Collections.synchronizedList(new ArrayList<>());
        this.rules.add(DownsamplingRule.defaultRule());
    }

    public DownsamplingEngine(LSMEngine engine, List<DownsamplingRule> rules) {
        this.engine = engine;
        this.rules = Collections.synchronizedList(new ArrayList<>(rules));
    }

    public void start() {
        downsamplingThread = new Thread(this::downsamplingLoop, "downsampling-thread");
        downsamplingThread.setDaemon(true);
        downsamplingThread.start();
        logger.info("Downsampling engine started with {} rules", rules.size());
    }

    private void downsamplingLoop() {
        while (running.get()) {
            try {
                long now = System.currentTimeMillis();
                long runInterval = getRunInterval();

                if (now - lastRunTime.get() >= runInterval) {
                    performDownsampling();
                    lastRunTime.set(now);
                }

                Thread.sleep(60000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                logger.error("Error in downsampling loop", e);
                try {
                    Thread.sleep(60000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private long getRunInterval() {
        long minRetention = Long.MAX_VALUE;
        for (DownsamplingRule rule : rules) {
            if (rule.isEnabled() && rule.getRetentionThreshold() < minRetention) {
                minRetention = rule.getRetentionThreshold();
            }
        }
        return Math.min(minRetention / 4, 24 * 60 * 60 * 1000L);
    }

    public void performDownsampling() throws IOException {
        if (rules.isEmpty()) {
            return;
        }

        logger.info("Starting downsampling process...");
        downsamplingCount.incrementAndGet();

        long startTime = System.currentTimeMillis();
        long downsampledPoints = 0;
        long aggregatedPoints = 0;

        synchronized (rules) {
            for (DownsamplingRule rule : rules) {
                if (!rule.isEnabled()) {
                    continue;
                }

                DownsamplingResult result = processRule(rule);
                downsampledPoints += result.downsampledPoints;
                aggregatedPoints += result.aggregatedPoints;
            }
        }

        totalDownsampledPoints.addAndGet(downsampledPoints);
        totalAggregatedPoints.addAndGet(aggregatedPoints);

        long duration = System.currentTimeMillis() - startTime;
        logger.info("Downsampling completed in {} ms: downsampled {} points, created {} aggregated points",
                duration, downsampledPoints, aggregatedPoints);
    }

    private DownsamplingResult processRule(DownsamplingRule rule) throws IOException {
        long cutoffTime = System.currentTimeMillis() - rule.getRetentionThreshold();
        logger.debug("Processing rule: {} (cutoff: {})", rule.getMetricPattern(), cutoffTime);

        Set<String> metrics = engine.getMetrics();
        DownsamplingResult result = new DownsamplingResult();

        for (String metric : metrics) {
            if (!rule.matches(metric)) {
                continue;
            }

            Set<String> seriesKeys = engine.getSeriesKeysForMetric(metric);
            for (String seriesKey : seriesKeys) {
                Tags tags = parseTagsFromSeriesKey(seriesKey);
                result = processSeries(metric, tags, rule, cutoffTime, result);
            }
        }

        return result;
    }

    private DownsamplingResult processSeries(String metric, Tags tags, DownsamplingRule rule,
                                             long cutoffTime, DownsamplingResult result) throws IOException {
        List<DataPoint> originalPoints = engine.rangeQuery(metric, tags.getTags(), 0, cutoffTime);

        if (originalPoints.isEmpty()) {
            return result;
        }

        Map<Long, AggregationBucket> buckets = new HashMap<>();
        for (DataPoint dp : originalPoints) {
            long bucketStart = rule.getBucketStart(dp.getTimestamp());
            buckets.computeIfAbsent(bucketStart, k -> new AggregationBucket(rule.getAggregationFunction()))
                    .add(dp.getValue());
        }

        List<DataPoint> aggregatedPoints = new ArrayList<>();
        String suffix = "_" + rule.getAggregationFunction().name().toLowerCase();
        for (Map.Entry<Long, AggregationBucket> entry : buckets.entrySet()) {
            double aggregatedValue = entry.getValue().getResult();
            DataPoint aggregatedDp = new DataPoint(
                    metric + suffix,
                    tags,
                    entry.getKey(),
                    aggregatedValue
            );
            aggregatedPoints.add(aggregatedDp);
        }

        if (!aggregatedPoints.isEmpty()) {
            engine.write(aggregatedPoints);
            result.aggregatedPoints += aggregatedPoints.size();
            result.downsampledPoints += originalPoints.size();
        }

        if (rule.isDeleteOriginalData()) {
            engine.deleteRange(metric, tags.getTags(), 0, cutoffTime);
        }

        return result;
    }

    private Tags parseTagsFromSeriesKey(String seriesKey) {
        Tags tags = new Tags();
        int hashIndex = seriesKey.indexOf('{');
        if (hashIndex > 0) {
            String tagsPart = seriesKey.substring(hashIndex + 1, seriesKey.length() - 1);
            if (!tagsPart.isEmpty()) {
                for (String pair : tagsPart.split(",")) {
                    String[] parts = pair.split("=");
                    if (parts.length == 2) {
                        tags.put(parts[0], parts[1]);
                    }
                }
            }
        }
        return tags;
    }

    public void addRule(DownsamplingRule rule) {
        rules.add(rule);
        logger.info("Added downsampling rule: {}", rule);
    }

    public boolean removeRule(DownsamplingRule rule) {
        boolean removed = rules.remove(rule);
        if (removed) {
            logger.info("Removed downsampling rule: {}", rule);
        }
        return removed;
    }

    public List<DownsamplingRule> getRules() {
        return new ArrayList<>(rules);
    }

    public void updateRule(int index, DownsamplingRule rule) {
        if (index >= 0 && index < rules.size()) {
            rules.set(index, rule);
            logger.info("Updated downsampling rule at index {}: {}", index, rule);
        }
    }

    public DownsamplingStats getStats() {
        DownsamplingStats stats = new DownsamplingStats();
        stats.totalDownsampledPoints = totalDownsampledPoints.get();
        stats.totalAggregatedPoints = totalAggregatedPoints.get();
        stats.lastRunTime = lastRunTime.get();
        stats.downsamplingCount = downsamplingCount.get();
        stats.rulesCount = rules.size();
        stats.enabledRulesCount = (int) rules.stream().filter(DownsamplingRule::isEnabled).count();
        return stats;
    }

    @Override
    public void close() {
        running.set(false);
        if (downsamplingThread != null) {
            try {
                downsamplingThread.join(5000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        logger.info("Downsampling engine closed");
    }

    private static class AggregationBucket {
        private final DownsamplingRule.AggregationFunction function;
        private double sum = 0;
        private double min = Double.MAX_VALUE;
        private double max = Double.MIN_VALUE;
        private long count = 0;

        public AggregationBucket(DownsamplingRule.AggregationFunction function) {
            this.function = function;
        }

        public void add(double value) {
            sum += value;
            min = Math.min(min, value);
            max = Math.max(max, value);
            count++;
        }

        public double getResult() {
            switch (function) {
                case AVG:
                    return count > 0 ? sum / count : 0;
                case MAX:
                    return max;
                case MIN:
                    return min;
                case SUM:
                    return sum;
                case COUNT:
                    return count;
                default:
                    return sum / count;
            }
        }
    }

    private static class DownsamplingResult {
        long downsampledPoints = 0;
        long aggregatedPoints = 0;
    }

    public static class DownsamplingStats {
        public long totalDownsampledPoints;
        public long totalAggregatedPoints;
        public long lastRunTime;
        public long downsamplingCount;
        public int rulesCount;
        public int enabledRulesCount;
    }
}
