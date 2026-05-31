package com.tsdb;

import com.tsdb.downsampling.DownsamplingRule;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

public class TSDBConfig {
    private final Properties properties;

    private TSDBConfig(Properties properties) {
        this.properties = properties;
    }

    public static TSDBConfig load() throws IOException {
        Properties properties = new Properties();

        Path configPath = Paths.get("config", "tsdb.properties");
        Files.createDirectories(configPath.getParent());
        if (Files.exists(configPath)) {
            try (InputStream is = new FileInputStream(configPath.toFile())) {
                properties.load(is);
            }
        } else {
            properties.setProperty("data.dir", "data");
            properties.setProperty("wal.dir", "data/wal");
            properties.setProperty("memtable.max.size", String.valueOf(64 * 1024 * 1024));
            properties.setProperty("compaction.min.sstables", "12");
            properties.setProperty("compaction.max.sstables", "24");
            properties.setProperty("compaction.level.max.size", String.valueOf(512 * 1024 * 1024));
            properties.setProperty("http.port", "8080");
            properties.setProperty("http.host", "0.0.0.0");

            properties.setProperty("downsampling.enabled", "true");
            properties.setProperty("downsampling.default.retention_days", "7");
            properties.setProperty("downsampling.default.interval_hours", "1");
            properties.setProperty("downsampling.default.function", "AVG");
            properties.setProperty("downsampling.default.metric_pattern", ".*");
            properties.setProperty("downsampling.default.delete_original", "true");
        }

        return new TSDBConfig(properties);
    }

    public List<DownsamplingRule> getDownsamplingRules() {
        List<DownsamplingRule> rules = new ArrayList<>();

        boolean enabled = Boolean.parseBoolean(properties.getProperty("downsampling.enabled", "true"));
        if (!enabled) {
            return rules;
        }

        String metricPattern = properties.getProperty("downsampling.default.metric_pattern", ".*");
        long retentionDays = Long.parseLong(properties.getProperty("downsampling.default.retention_days", "7"));
        long intervalHours = Long.parseLong(properties.getProperty("downsampling.default.interval_hours", "1"));
        String functionStr = properties.getProperty("downsampling.default.function", "AVG");
        boolean deleteOriginal = Boolean.parseBoolean(properties.getProperty("downsampling.default.delete_original", "true"));

        DownsamplingRule.AggregationFunction function;
        try {
            function = DownsamplingRule.AggregationFunction.valueOf(functionStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            function = DownsamplingRule.AggregationFunction.AVG;
        }

        DownsamplingRule defaultRule = new DownsamplingRule(
                metricPattern,
                TimeUnit.DAYS.toMillis(retentionDays),
                TimeUnit.HOURS.toMillis(intervalHours),
                function
        );
        defaultRule.setDeleteOriginalData(deleteOriginal);
        rules.add(defaultRule);

        int ruleIndex = 1;
        while (true) {
            String prefix = "downsampling.rule" + ruleIndex + ".";
            String pattern = properties.getProperty(prefix + "metric_pattern");
            if (pattern == null) {
                break;
            }

            long retDays = Long.parseLong(properties.getProperty(prefix + "retention_days", "7"));
            long intHours = Long.parseLong(properties.getProperty(prefix + "interval_hours", "1"));
            String funcStr = properties.getProperty(prefix + "function", "AVG");
            boolean delOrig = Boolean.parseBoolean(properties.getProperty(prefix + "delete_original", "true"));

            DownsamplingRule.AggregationFunction func;
            try {
                func = DownsamplingRule.AggregationFunction.valueOf(funcStr.toUpperCase());
            } catch (IllegalArgumentException e) {
                func = DownsamplingRule.AggregationFunction.AVG;
            }

            DownsamplingRule rule = new DownsamplingRule(
                    pattern,
                    TimeUnit.DAYS.toMillis(retDays),
                    TimeUnit.HOURS.toMillis(intHours),
                    func
            );
            rule.setDeleteOriginalData(delOrig);
            rules.add(rule);

            ruleIndex++;
        }

        return rules;
    }

    public String getDataDir() {
        return properties.getProperty("data.dir", "data");
    }

    public String getWalDir() {
        return properties.getProperty("wal.dir", "data/wal");
    }

    public long getMemtableMaxSize() {
        return Long.parseLong(properties.getProperty("memtable.max.size", String.valueOf(64 * 1024 * 1024)));
    }

    public int getCompactionMinSSTables() {
        return Integer.parseInt(properties.getProperty("compaction.min.sstables", "12"));
    }

    public int getCompactionMaxSSTables() {
        return Integer.parseInt(properties.getProperty("compaction.max.sstables", "24"));
    }

    public long getCompactionLevelMaxSize() {
        return Long.parseLong(properties.getProperty("compaction.level.max.size", String.valueOf(512 * 1024 * 1024)));
    }

    public int getHttpPort() {
        return Integer.parseInt(properties.getProperty("http.port", "8080"));
    }

    public String getHttpHost() {
        return properties.getProperty("http.host", "0.0.0.0");
    }
}
