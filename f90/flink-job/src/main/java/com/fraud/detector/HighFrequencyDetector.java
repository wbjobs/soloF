package com.fraud.detector;

import com.fraud.model.Alert;
import com.fraud.model.Transaction;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class HighFrequencyDetector extends KeyedProcessFunction<String, Transaction, Transaction> {

    private final OutputTag<Alert> alertOutputTag;
    private transient MapState<Long, Integer> secondCountState;
    private transient ValueState<Long> lastCleanupTimeState;
    private static final long WINDOW_MS = 1000L;
    private static final int THRESHOLD = 5;
    private static final long CLEANUP_INTERVAL_MS = 60000L;

    public HighFrequencyDetector(OutputTag<Alert> alertOutputTag) {
        this.alertOutputTag = alertOutputTag;
    }

    @Override
    public void open(Configuration parameters) {
        MapStateDescriptor<Long, Integer> countDescriptor =
                new MapStateDescriptor<>("second-counts", Long.class, Integer.class);
        secondCountState = getRuntimeContext().getMapState(countDescriptor);

        ValueStateDescriptor<Long> cleanupDescriptor =
                new ValueStateDescriptor<>("last-cleanup-time", Long.class);
        lastCleanupTimeState = getRuntimeContext().getState(cleanupDescriptor);
    }

    @Override
    public void processElement(Transaction transaction, Context ctx, Collector<Transaction> out) throws Exception {
        long eventTime = transaction.getTimestamp().atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
        long secondKey = eventTime / WINDOW_MS;

        Integer currentCount = secondCountState.get(secondKey);
        int newCount = (currentCount == null ? 0 : currentCount) + 1;
        secondCountState.put(secondKey, newCount);

        if (newCount > THRESHOLD) {
            Alert alert = new Alert(
                    UUID.randomUUID().toString(),
                    transaction.getUserId(),
                    "HIGH_FREQUENCY",
                    "高频交易检测: 1秒内完成" + newCount + "笔交易",
                    "HIGH",
                    transaction.getTransactionId(),
                    transaction.getTimestamp(),
                    "1秒内交易数量: " + newCount
            );
            ctx.output(alertOutputTag, alert);
        }

        Long lastCleanupTime = lastCleanupTimeState.value();
        long currentTime = System.currentTimeMillis();
        if (lastCleanupTime == null || (currentTime - lastCleanupTime) > CLEANUP_INTERVAL_MS) {
            cleanupOldEntries(secondKey);
            lastCleanupTimeState.update(currentTime);
        }

        out.collect(transaction);
    }

    private void cleanupOldEntries(long currentSecondKey) throws Exception {
        long cutoffKey = currentSecondKey - 2;
        Iterator<Map.Entry<Long, Integer>> iterator = secondCountState.entries().iterator();
        List<Long> keysToRemove = new ArrayList<>();

        while (iterator.hasNext()) {
            Map.Entry<Long, Integer> entry = iterator.next();
            if (entry.getKey() < cutoffKey) {
                keysToRemove.add(entry.getKey());
            }
        }

        for (Long key : keysToRemove) {
            secondCountState.remove(key);
        }
    }
}
