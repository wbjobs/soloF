package com.tsdb;

import com.tsdb.downsampling.DownsamplingEngine;
import com.tsdb.downsampling.DownsamplingRule;
import com.tsdb.engine.LSMEngine;
import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class TSDBExample {
    public static void main(String[] args) throws Exception {
        String dataDir = "data/test";
        String walDir = "data/test/wal";

        LSMEngine engine = new LSMEngine(
                dataDir,
                walDir,
                4 * 1024 * 1024,
                8,
                16,
                64 * 1024 * 1024
        );

        System.out.println("=== Step 1: Creating downsampling rules ===");
        DownsamplingEngine downsamplingEngine = new DownsamplingEngine(engine);

        downsamplingEngine.addRule(new DownsamplingRule(
                "cpu_.*",
                TimeUnit.DAYS.toMillis(7),
                TimeUnit.HOURS.toMillis(1),
                DownsamplingRule.AggregationFunction.AVG
        ));

        downsamplingEngine.addRule(new DownsamplingRule(
                "memory_.*",
                TimeUnit.DAYS.toMillis(7),
                TimeUnit.HOURS.toMillis(1),
                DownsamplingRule.AggregationFunction.MAX
        ));

        System.out.println("Downsampling rules configured:");
        for (int i = 0; i < downsamplingEngine.getRules().size(); i++) {
            DownsamplingRule rule = downsamplingEngine.getRules().get(i);
            System.out.printf("  Rule %d: metric=%s, retention=%d days, interval=%d hours, function=%s%n",
                    i, rule.getMetricPattern(),
                    TimeUnit.MILLISECONDS.toDays(rule.getRetentionThreshold()),
                    TimeUnit.MILLISECONDS.toHours(rule.getAggregationInterval()),
                    rule.getAggregationFunction());
        }

        System.out.println("\n=== Step 2: Writing test data with mixed timestamps ===");
        long now = System.currentTimeMillis();
        long eightDaysAgo = now - TimeUnit.DAYS.toMillis(8);
        long twoDaysAgo = now - TimeUnit.DAYS.toMillis(2);

        Tags[] tagsArray = new Tags[5];
        for (int i = 0; i < 5; i++) {
            tagsArray[i] = Tags.of("host", "server" + i, "region", "us-east-" + (i % 3));
        }

        String[] metrics = {"cpu_usage", "memory_usage", "disk_io"};
        long writeStart = System.currentTimeMillis();

        for (int i = 0; i < 500; i++) {
            long oldTs = eightDaysAgo + i * 60000;
            long recentTs = twoDaysAgo + i * 60000;

            for (int m = 0; m < metrics.length; m++) {
                for (Tags tags : tagsArray) {
                    DataPoint oldDp = new DataPoint(metrics[m], tags, oldTs, Math.random() * 100);
                    DataPoint recentDp = new DataPoint(metrics[m], tags, recentTs, Math.random() * 100);
                    engine.write(oldDp);
                    engine.write(recentDp);
                }
            }
            if ((i + 1) % 100 == 0) {
                System.out.printf("  Written %d points...%n", (i + 1) * 3 * 5 * 2);
            }
        }

        long writeEnd = System.currentTimeMillis();
        System.out.printf("Wrote 15,000 data points in %d ms%n", writeEnd - writeStart);

        System.out.println("\n=== Step 3: Querying old data (8 days ago) BEFORE downsampling ===");
        Map<String, String> filter = new HashMap<>();
        filter.put("host", "server0");

        List<DataPoint> oldResults = engine.rangeQuery("cpu_usage", filter, eightDaysAgo, eightDaysAgo + TimeUnit.HOURS.toMillis(1));
        System.out.println("Found " + oldResults.size() + " original points for cpu_usage{host=server0} (8 days ago)");
        for (int i = 0; i < Math.min(3, oldResults.size()); i++) {
            DataPoint dp = oldResults.get(i);
            System.out.printf("  ts=%d, value=%.2f%n", dp.getTimestamp(), dp.getValue());
        }

        System.out.println("\n=== Step 4: Running downsampling manually ===");
        long downsampleStart = System.currentTimeMillis();
        downsamplingEngine.performDownsampling();
        long downsampleEnd = System.currentTimeMillis();
        System.out.printf("Downsampling completed in %d ms%n", downsampleEnd - downsampleStart);

        DownsamplingEngine.DownsamplingStats dsStats = downsamplingEngine.getStats();
        System.out.printf("  Points downsampled: %d%n", dsStats.totalDownsampledPoints);
        System.out.printf("  Aggregated points created: %d%n", dsStats.totalAggregatedPoints);

        System.out.println("\n=== Step 5: Querying downsampled data ===");
        List<DataPoint> avgResults = engine.rangeQuery("cpu_usage_avg", filter, eightDaysAgo, eightDaysAgo + TimeUnit.HOURS.toMillis(24));
        System.out.println("Found " + avgResults.size() + " downsampled points for cpu_usage_avg{host=server0}");
        for (int i = 0; i < Math.min(5, avgResults.size()); i++) {
            DataPoint dp = avgResults.get(i);
            System.out.printf("  ts=%d, avg_value=%.2f%n", dp.getTimestamp(), dp.getValue());
        }

        System.out.println("\n=== Step 6: Querying memory max downsampled data ===");
        List<DataPoint> maxResults = engine.rangeQuery("memory_usage_max", filter, eightDaysAgo, eightDaysAgo + TimeUnit.HOURS.toMillis(24));
        System.out.println("Found " + maxResults.size() + " downsampled points for memory_usage_max{host=server0}");
        for (int i = 0; i < Math.min(5, maxResults.size()); i++) {
            DataPoint dp = maxResults.get(i);
            System.out.printf("  ts=%d, max_value=%.2f%n", dp.getTimestamp(), dp.getValue());
        }

        System.out.println("\n=== Step 7: Verifying recent data is preserved ===");
        List<DataPoint> recentResults = engine.rangeQuery("cpu_usage", filter, twoDaysAgo, twoDaysAgo + TimeUnit.HOURS.toMillis(1));
        System.out.println("Found " + recentResults.size() + " original points for cpu_usage{host=server0} (2 days ago) - NOT downsampled");

        System.out.println("\n=== Engine Statistics ===");
        LSMEngine.EngineStats stats = engine.getStats();
        System.out.printf("Total metrics tracked: %d%n", engine.getMetrics().size());
        System.out.printf("Total time series: %d%n", engine.getSeriesKeysForMetric("cpu_usage").size());
        System.out.printf("Total points written: %d%n", stats.totalWritePoints);
        System.out.printf("Total SSTable entries: %d%n", stats.totalSSTableEntries);
        System.out.printf("Total SSTable size: %.2f MB%n", stats.totalSSTableSize / 1024.0 / 1024.0);

        downsamplingEngine.close();
        engine.close();
        System.out.println("\nExample completed successfully!");
    }
}
