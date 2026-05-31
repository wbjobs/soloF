package com.fraud.detector;

import com.fraud.model.Alert;
import com.fraud.model.Transaction;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;

import java.util.UUID;

public class SuddenAmountIncreaseDetector extends KeyedProcessFunction<String, Transaction, Transaction> {

    private final OutputTag<Alert> alertOutputTag;
    private transient ValueState<ApproximateQuantile> quantileState;
    private transient ValueState<Long> sampleCountState;
    private static final int TOTAL_BUCKETS = 1000;
    private static final double MAX_AMOUNT = 1000000.0;
    private static final double PERCENTILE_THRESHOLD = 0.9;
    private static final double MULTIPLIER = 3.0;
    private static final int MIN_SAMPLES = 50;

    public SuddenAmountIncreaseDetector(OutputTag<Alert> alertOutputTag) {
        this.alertOutputTag = alertOutputTag;
    }

    @Override
    public void open(Configuration parameters) {
        ValueStateDescriptor<ApproximateQuantile> quantileDescriptor =
                new ValueStateDescriptor<>("approximate-quantile", ApproximateQuantile.class);
        quantileState = getRuntimeContext().getState(quantileDescriptor);

        ValueStateDescriptor<Long> countDescriptor =
                new ValueStateDescriptor<>("sample-count", Long.class);
        sampleCountState = getRuntimeContext().getState(countDescriptor);
    }

    @Override
    public void processElement(Transaction transaction, Context ctx, Collector<Transaction> out) throws Exception {
        double currentAmount = transaction.getAmount();

        ApproximateQuantile quantile = quantileState.value();
        if (quantile == null) {
            quantile = new ApproximateQuantile(TOTAL_BUCKETS, MAX_AMOUNT);
        }

        Long sampleCount = sampleCountState.value();
        if (sampleCount == null) {
            sampleCount = 0L;
        }

        quantile.addValue(currentAmount);
        sampleCount++;

        if (sampleCount >= MIN_SAMPLES) {
            double percentile90 = quantile.getQuantile(PERCENTILE_THRESHOLD);

            if (percentile90 > 0 && currentAmount > percentile90 * MULTIPLIER) {
                Alert alert = new Alert(
                        UUID.randomUUID().toString(),
                        transaction.getUserId(),
                        "SUDDEN_AMOUNT_INCREASE",
                        "金额突增检测: 当前金额¥" + String.format("%.2f", currentAmount) +
                                " 超过历史90分位数¥" + String.format("%.2f", percentile90) + "的3倍",
                        "CRITICAL",
                        transaction.getTransactionId(),
                        transaction.getTimestamp(),
                        "当前金额: ¥" + String.format("%.2f", currentAmount) +
                                ", 90分位数: ¥" + String.format("%.2f", percentile90) +
                                ", 历史样本数: " + sampleCount
                );
                ctx.output(alertOutputTag, alert);
            }
        }

        quantileState.update(quantile);
        sampleCountState.update(sampleCount);
        out.collect(transaction);
    }

    public static class ApproximateQuantile implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        private int[] buckets;
        private int totalBuckets;
        private double maxAmount;
        private long totalCount;

        public ApproximateQuantile() {}

        public ApproximateQuantile(int totalBuckets, double maxAmount) {
            this.totalBuckets = totalBuckets;
            this.maxAmount = maxAmount;
            this.buckets = new int[totalBuckets];
            this.totalCount = 0;
        }

        public void addValue(double value) {
            if (value < 0) value = 0;
            if (value > maxAmount) value = maxAmount;

            int bucketIndex = (int) (value / maxAmount * (totalBuckets - 1));
            if (bucketIndex >= totalBuckets) bucketIndex = totalBuckets - 1;
            if (bucketIndex < 0) bucketIndex = 0;

            buckets[bucketIndex]++;
            totalCount++;
        }

        public double getQuantile(double percentile) {
            if (totalCount == 0) return 0;

            long targetCount = (long) (totalCount * percentile);
            long cumulativeCount = 0;

            for (int i = 0; i < totalBuckets; i++) {
                cumulativeCount += buckets[i];
                if (cumulativeCount >= targetCount) {
                    double bucketStart = (double) i / totalBuckets * maxAmount;
                    double bucketEnd = (double) (i + 1) / totalBuckets * maxAmount;

                    long bucketTarget = targetCount - (cumulativeCount - buckets[i]);
                    double fraction = buckets[i] > 0 ? (double) bucketTarget / buckets[i] : 0.5;

                    return bucketStart + fraction * (bucketEnd - bucketStart);
                }
            }

            return maxAmount;
        }

        public int[] getBuckets() { return buckets; }
        public void setBuckets(int[] buckets) { this.buckets = buckets; }
        public int getTotalBuckets() { return totalBuckets; }
        public void setTotalBuckets(int totalBuckets) { this.totalBuckets = totalBuckets; }
        public double getMaxAmount() { return maxAmount; }
        public void setMaxAmount(double maxAmount) { this.maxAmount = maxAmount; }
        public long getTotalCount() { return totalCount; }
        public void setTotalCount(long totalCount) { this.totalCount = totalCount; }
    }
}
