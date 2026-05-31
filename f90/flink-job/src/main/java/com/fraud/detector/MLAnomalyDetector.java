package com.fraud.detector;

import com.fraud.ml.FeatureExtractor;
import com.fraud.ml.IsolationForestModel;
import com.fraud.model.Alert;
import com.fraud.model.Transaction;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class MLAnomalyDetector extends KeyedProcessFunction<String, FeatureExtractor.TransactionWithFeatures, FeatureExtractor.TransactionWithFeatures> {

    private final OutputTag<Alert> mlAlertTag;
    private transient ValueState<IsolationForestModel> modelState;
    private transient ValueState<Long> lastModelUpdateState;
    private static final long MODEL_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
    private static final double ANOMALY_THRESHOLD = 0.7;
    private static final int MIN_SAMPLES_FOR_PREDICTION = 100;

    public MLAnomalyDetector(OutputTag<Alert> mlAlertTag) {
        this.mlAlertTag = mlAlertTag;
    }

    @Override
    public void open(Configuration parameters) {
        ValueStateDescriptor<IsolationForestModel> modelDescriptor =
                new ValueStateDescriptor<>("isolation-forest-model", IsolationForestModel.class);
        modelState = getRuntimeContext().getState(modelDescriptor);

        ValueStateDescriptor<Long> updateDescriptor =
                new ValueStateDescriptor<>("last-model-update", Long.class);
        lastModelUpdateState = getRuntimeContext().getState(updateDescriptor);
    }

    @Override
    public void processElement(FeatureExtractor.TransactionWithFeatures txWithFeatures,
                               Context ctx,
                               Collector<FeatureExtractor.TransactionWithFeatures> out) throws Exception {
        IsolationForestModel model = modelState.value();
        Transaction tx = txWithFeatures.transaction;
        double[] features = txWithFeatures.features;

        if (model == null) {
            model = new IsolationForestModel(50, 128, ANOMALY_THRESHOLD, System.nanoTime());
            initializeModelWithDefaultData(model);
            modelState.update(model);
        }

        if (model.getTotalSamples() >= MIN_SAMPLES_FOR_PREDICTION) {
            double anomalyScore = model.predictAnomalyScore(features);

            if (anomalyScore >= ANOMALY_THRESHOLD) {
                Alert alert = new Alert(
                        UUID.randomUUID().toString(),
                        tx.getUserId(),
                        "ML_ANOMALY",
                        "机器学习异常检测: 异常评分 " + String.format("%.3f", anomalyScore) +
                                " (阈值: " + ANOMALY_THRESHOLD + ")",
                        anomalyScore >= 0.85 ? "CRITICAL" : "HIGH",
                        tx.getTransactionId(),
                        tx.getTimestamp(),
                        "异常评分: " + String.format("%.3f", anomalyScore) +
                                ", 模型训练样本数: " + model.getTotalSamples() +
                                ", 特征数: " + features.length
                );
                ctx.output(mlAlertTag, alert);
            }
        }

        out.collect(txWithFeatures);
    }

    private void initializeModelWithDefaultData(IsolationForestModel model) {
        int normalSamples = 500;
        int anomalySamples = 50;
        int featureCount = 28;

        double[][] initialSamples = new double[normalSamples + anomalySamples][];
        boolean[] labels = new boolean[normalSamples + anomalySamples];
        java.util.Random rnd = new java.util.Random(42);

        for (int i = 0; i < normalSamples; i++) {
            initialSamples[i] = generateNormalSample(featureCount, rnd);
            labels[i] = false;
        }

        for (int i = 0; i < anomalySamples; i++) {
            initialSamples[normalSamples + i] = generateAnomalySample(featureCount, rnd);
            labels[normalSamples + i] = true;
        }

        model.initialize(initialSamples, labels);
    }

    private double[] generateNormalSample(int featureCount, java.util.Random rnd) {
        double[] sample = new double[featureCount];
        for (int i = 0; i < featureCount; i++) {
            sample[i] = rnd.nextGaussian() * 1 + 5;
        }
        sample[0] = 50 + rnd.nextDouble() * 500;
        sample[1] = Math.log(sample[0] + 1);
        sample[6] = 9 + rnd.nextInt(9);
        return sample;
    }

    private double[] generateAnomalySample(int featureCount, java.util.Random rnd) {
        double[] sample = new double[featureCount];
        for (int i = 0; i < featureCount; i++) {
            sample[i] = rnd.nextGaussian() * 3 + 5;
        }
        sample[0] = 10000 + rnd.nextDouble() * 90000;
        sample[1] = Math.log(sample[0] + 1);
        sample[3] = 5 + rnd.nextDouble() * 20;
        sample[6] = rnd.nextBoolean() ? 2 + rnd.nextInt(3) : 20 + rnd.nextInt(4);
        return sample;
    }

    public void updateModel(IsolationForestModel newModel) {
        try {
            modelState.update(newModel);
        } catch (Exception e) {
        }
    }
}
