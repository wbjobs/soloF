package com.fraud;

import com.fraud.detector.CrossRegionLoginDetector;
import com.fraud.detector.HighFrequencyDetector;
import com.fraud.detector.MLAnomalyDetector;
import com.fraud.detector.SuddenAmountIncreaseDetector;
import com.fraud.ml.FeatureExtractor;
import com.fraud.ml.IsolationForestModel;
import com.fraud.ml.ModelBroadcastSource;
import com.fraud.model.Alert;
import com.fraud.model.Transaction;
import com.fraud.sink.RedisAlertSink;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.configuration.MemorySize;
import org.apache.flink.connector.base.DeliveryGuarantee;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.contrib.streaming.state.EmbeddedRocksDBStateBackend;
import org.apache.flink.streaming.api.datastream.BroadcastStream;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.time.Duration;

public class FraudDetectionJob {

    public static final MapStateDescriptor<Void, IsolationForestModel> MODEL_STATE_DESC =
            new MapStateDescriptor<>(
                    "model-broadcast-state",
                    BasicTypeInfo.VOID_TYPE_INFO,
                    TypeInformation.of(IsolationForestModel.class)
            );

    public static void main(String[] args) throws Exception {
        String kafkaBrokers = args.length > 0 ? args[0] : "localhost:9092";
        String kafkaTopic = args.length > 1 ? args[1] : "transactions";
        String redisHost = args.length > 2 ? args[2] : "localhost";
        int redisPort = args.length > 3 ? Integer.parseInt(args[3]) : 6379;

        Configuration flinkConfig = new Configuration();
        flinkConfig.set(
                org.apache.flink.configuration.CheckpointingOptions.CHECKPOINTS_DIRECTORY,
                "file:///tmp/flink-checkpoints"
        );
        flinkConfig.set(
                org.apache.flink.configuration.StateBackendOptions.STATE_BACKEND,
                "rocksdb"
        );
        flinkConfig.set(
                org.apache.flink.configuration.TaskManagerOptions.NETWORK_MEMORY_MIN,
                MemorySize.parse("128mb")
        );
        flinkConfig.set(
                org.apache.flink.configuration.TaskManagerOptions.NETWORK_MEMORY_MAX,
                MemorySize.parse("1gb")
        );
        flinkConfig.set(
                org.apache.flink.configuration.ExecutionOptions.BUFFER_TIMEOUT,
                Duration.ofMillis(100)
        );

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment(flinkConfig);
        env.setParallelism(4);

        EmbeddedRocksDBStateBackend rocksDBStateBackend = new EmbeddedRocksDBStateBackend(true);
        rocksDBStateBackend.setDbStoragePath("file:///tmp/flink-state/rocksdb");
        env.getCheckpointConfig().setCheckpointStorage("file:///tmp/flink-checkpoints");
        env.setStateBackend(rocksDBStateBackend);

        env.enableCheckpointing(120000);
        env.getCheckpointConfig().setCheckpointTimeout(300000);
        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(60000);
        env.getCheckpointConfig().setMaxConcurrentCheckpoints(1);
        env.getCheckpointConfig().setTolerableCheckpointFailureNumber(3);
        env.getCheckpointConfig().enableUnalignedCheckpoints();
        env.getCheckpointConfig().setAlignedCheckpointTimeout(Duration.ofSeconds(30));

        env.getCheckpointConfig().enableExternalizedCheckpoints(
                org.apache.flink.streaming.api.environment.CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
        );

        env.setRestartStrategy(
                org.apache.flink.api.common.restartstrategy.RestartStrategies.fixedDelayRestart(
                        5,
                        org.apache.flink.api.common.time.Time.seconds(30)
                )
        );

        KafkaSource<String> kafkaSource = KafkaSource.<String>builder()
                .setBootstrapServers(kafkaBrokers)
                .setTopics(kafkaTopic)
                .setGroupId("fraud-detection-group")
                .setStartingOffsets(OffsetsInitializer.latest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                .setProperty("fetch.min.bytes", "1024")
                .setProperty("fetch.max.wait.ms", "200")
                .build();

        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());

        DataStream<String> kafkaStream = env.fromSource(
                kafkaSource,
                WatermarkStrategy.noWatermarks(),
                "Kafka Source"
        );

        DataStream<Transaction> transactionStream = kafkaStream
                .map(json -> objectMapper.readValue(json, Transaction.class))
                .name("Parse Transaction")
                .filter(tx -> tx.getUserId() != null && tx.getTimestamp() != null)
                .name("Filter Valid Transactions");

        DataStream<IsolationForestModel> modelStream = env.addSource(
                        new ModelBroadcastSource(redisHost, redisPort))
                .name("Model Broadcast Source")
                .uid("model-broadcast-source");

        BroadcastStream<IsolationForestModel> modelBroadcastStream =
                modelStream.broadcast(MODEL_STATE_DESC);

        OutputTag<Alert> highFreqAlertTag = new OutputTag<Alert>("high-frequency-alerts") {};
        OutputTag<Alert> suddenAmountAlertTag = new OutputTag<Alert>("sudden-amount-alerts") {};
        OutputTag<Alert> crossRegionAlertTag = new OutputTag<Alert>("cross-region-alerts") {};
        OutputTag<Alert> mlAlertTag = new OutputTag<Alert>("ml-anomaly-alerts") {};

        SingleOutputStreamOperator<Transaction> highFreqProcessed = transactionStream
                .keyBy(Transaction::getUserId)
                .process(new HighFrequencyDetector(highFreqAlertTag))
                .name("High Frequency Detector")
                .uid("high-frequency-detector");

        DataStream<Alert> highFreqAlerts = highFreqProcessed.getSideOutput(highFreqAlertTag);

        SingleOutputStreamOperator<Transaction> suddenAmountProcessed = highFreqProcessed
                .keyBy(Transaction::getUserId)
                .process(new SuddenAmountIncreaseDetector(suddenAmountAlertTag))
                .name("Sudden Amount Increase Detector")
                .uid("sudden-amount-detector");

        DataStream<Alert> suddenAmountAlerts = suddenAmountProcessed.getSideOutput(suddenAmountAlertTag);

        SingleOutputStreamOperator<Transaction> crossRegionProcessed = suddenAmountProcessed
                .keyBy(Transaction::getUserId)
                .process(new CrossRegionLoginDetector(crossRegionAlertTag))
                .name("Cross-Region Login Detector")
                .uid("cross-region-detector");

        DataStream<Alert> crossRegionAlerts = crossRegionProcessed.getSideOutput(crossRegionAlertTag);

        SingleOutputStreamOperator<FeatureExtractor.TransactionWithFeatures> featureStream =
                crossRegionProcessed
                        .keyBy(Transaction::getUserId)
                        .process(new FeatureExtractor())
                        .name("Feature Extractor")
                        .uid("feature-extractor");

        SingleOutputStreamOperator<FeatureExtractor.TransactionWithFeatures> mlProcessedStream =
                featureStream
                        .keyBy(tx -> tx.transaction.getUserId())
                        .connect(modelBroadcastStream)
                        .process(new MLAnomalyBroadcastProcessFunction(mlAlertTag))
                        .name("ML Anomaly Detector")
                        .uid("ml-anomaly-detector");

        DataStream<Alert> mlAlerts = mlProcessedStream.getSideOutput(mlAlertTag);

        DataStream<Alert> allAlerts = highFreqAlerts
                .union(suddenAmountAlerts)
                .union(crossRegionAlerts)
                .union(mlAlerts)
                .name("Union All Alerts");

        allAlerts.addSink(new RedisAlertSink(redisHost, redisPort))
                .name("Redis Alert Sink")
                .uid("redis-alert-sink");

        allAlerts.print()
                .name("Print Alerts");

        env.execute("Real-time Fraud Detection Job with ML - High Performance");
    }

    public static class MLAnomalyBroadcastProcessFunction
            extends KeyedBroadcastProcessFunction<String,
            FeatureExtractor.TransactionWithFeatures,
            IsolationForestModel,
            FeatureExtractor.TransactionWithFeatures> {

        private final OutputTag<Alert> mlAlertTag;
        private transient ValueState<IsolationForestModel> localModelState;
        private static final double ANOMALY_THRESHOLD = 0.7;
        private static final int MIN_SAMPLES_FOR_PREDICTION = 100;

        public MLAnomalyBroadcastProcessFunction(OutputTag<Alert> mlAlertTag) {
            this.mlAlertTag = mlAlertTag;
        }

        @Override
        public void open(Configuration parameters) {
            ValueStateDescriptor<IsolationForestModel> modelDescriptor =
                    new ValueStateDescriptor<>("local-ml-model", IsolationForestModel.class);
            localModelState = getRuntimeContext().getState(modelDescriptor);
        }

        @Override
        public void processElement(
                FeatureExtractor.TransactionWithFeatures txWithFeatures,
                ReadOnlyContext ctx,
                Collector<FeatureExtractor.TransactionWithFeatures> out) throws Exception {

            IsolationForestModel model = localModelState.value();

            if (model == null) {
                IsolationForestModel broadcastModel = ctx.getBroadcastState(MODEL_STATE_DESC).get(null);
                if (broadcastModel != null) {
                    model = broadcastModel;
                    localModelState.update(model);
                } else {
                    model = new IsolationForestModel(50, 128, ANOMALY_THRESHOLD, System.nanoTime());
                    initializeDefaultModel(model);
                    localModelState.update(model);
                }
            }

            Transaction tx = txWithFeatures.transaction;
            double[] features = txWithFeatures.features;

            if (model.getTotalSamples() >= MIN_SAMPLES_FOR_PREDICTION) {
                double anomalyScore = model.predictAnomalyScore(features);

                if (anomalyScore >= ANOMALY_THRESHOLD) {
                    Alert alert = new Alert(
                            java.util.UUID.randomUUID().toString(),
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

        @Override
        public void processBroadcastElement(
                IsolationForestModel newModel,
                Context ctx,
                Collector<FeatureExtractor.TransactionWithFeatures> out) throws Exception {

            ctx.getBroadcastState(MODEL_STATE_DESC).put(null, newModel);

            if (localModelState != null) {
                localModelState.update(newModel);
            }
        }

        private void initializeDefaultModel(IsolationForestModel model) {
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
    }
}
