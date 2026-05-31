package com.fraud.ml;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class ModelUpdateService {

    private static final Logger logger = LoggerFactory.getLogger(ModelUpdateService.class);
    private static final long UPDATE_INTERVAL_MS = 10 * 60 * 1000;
    private static final int MAX_SAMPLES_PER_UPDATE = 1000;
    private static final int MIN_SAMPLES_FOR_UPDATE = 10;

    private final SampleStore sampleStore;
    private IsolationForestModel currentModel;
    private volatile boolean running;

    public ModelUpdateService(String redisHost, int redisPort) {
        this.sampleStore = new SampleStore(redisHost, redisPort);
    }

    public void start() {
        running = true;
        logger.info("Model Update Service started. Update interval: {} seconds", UPDATE_INTERVAL_MS / 1000);

        loadOrInitializeModel();

        Thread updateThread = new Thread(this::runUpdateLoop, "model-update-service");
        updateThread.setDaemon(false);
        updateThread.start();
    }

    private void loadOrInitializeModel() {
        currentModel = sampleStore.loadModel();

        if (currentModel == null) {
            logger.info("No existing model found. Initializing new model...");
            currentModel = new IsolationForestModel(100, 256, 0.7, System.nanoTime());

            List<SampleStore.LabeledSample> allSamples = sampleStore.getAllLabeledSamples();
            if (allSamples.size() >= 100) {
                trainInitialModel(allSamples);
            } else {
                logger.info("Not enough samples for initial training. Using synthetic data for initialization.");
                initializeWithSyntheticData();
            }
            sampleStore.saveModel(currentModel);
            logger.info("Model initialized and saved. Version: {}", sampleStore.getModelVersion());
        } else {
            logger.info("Loaded existing model. Total samples: {}, Version: {}",
                    currentModel.getTotalSamples(), sampleStore.getModelVersion());
        }
    }

    private void trainInitialModel(List<SampleStore.LabeledSample> samples) {
        int size = samples.size();
        double[][] features = new double[size][];
        boolean[] labels = new boolean[size];

        for (int i = 0; i < size; i++) {
            SampleStore.LabeledSample sample = samples.get(i);
            features[i] = sample.features;
            labels[i] = sample.isAnomaly;
        }

        currentModel.initialize(features, labels);
        logger.info("Initial model trained with {} samples ({} anomalies)",
                size, countAnomalies(labels));
    }

    private void initializeWithSyntheticData() {
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

        currentModel.initialize(initialSamples, labels);
        logger.info("Model initialized with synthetic data: {} normal, {} anomaly",
                normalSamples, anomalySamples);
    }

    private void runUpdateLoop() {
        while (running) {
            try {
                long startTime = System.currentTimeMillis();
                performUpdate();
                long elapsed = System.currentTimeMillis() - startTime;

                long sleepTime = Math.max(0, UPDATE_INTERVAL_MS - elapsed);
                if (sleepTime > 0) {
                    logger.debug("Update completed in {}ms. Sleeping for {}ms until next update.",
                            elapsed, sleepTime);
                    Thread.sleep(sleepTime);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                logger.info("Model update service interrupted");
                break;
            } catch (Exception e) {
                logger.error("Error during model update", e);
                try {
                    Thread.sleep(60000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private void performUpdate() {
        int queueSize = sampleStore.getTrainingQueueSize();
        logger.info("Checking for new training samples. Queue size: {}", queueSize);

        if (queueSize < MIN_SAMPLES_FOR_UPDATE) {
            logger.debug("Not enough new samples ({} < {}). Skipping update.",
                    queueSize, MIN_SAMPLES_FOR_UPDATE);
            return;
        }

        List<SampleStore.LabeledSample> newSamples =
                sampleStore.getNewSamplesForTraining(MAX_SAMPLES_PER_UPDATE);

        if (newSamples.isEmpty()) {
            logger.debug("No new samples to process.");
            return;
        }

        logger.info("Processing {} new samples for incremental training...", newSamples.size());

        int anomalyCount = 0;
        for (SampleStore.LabeledSample sample : newSamples) {
            if (sample.isAnomaly) anomalyCount++;
        }

        int size = newSamples.size();
        double[][] features = new double[size][];
        boolean[] labels = new boolean[size];

        for (int i = 0; i < size; i++) {
            SampleStore.LabeledSample sample = newSamples.get(i);
            features[i] = sample.features;
            labels[i] = sample.isAnomaly;
        }

        double oldThreshold = currentModel.getAnomalyThreshold();
        currentModel.updateIncremental(features, labels);

        adaptThreshold(newSamples);

        sampleStore.saveModel(currentModel);
        long newVersion = sampleStore.getModelVersion();

        logger.info("Model updated successfully. " +
                        "Version: {}, " +
                        "New samples: {} ({} anomalies), " +
                        "Total samples: {}, " +
                        "Threshold: {:.3f} -> {:.3f}",
                newVersion,
                size, anomalyCount,
                currentModel.getTotalSamples(),
                oldThreshold, currentModel.getAnomalyThreshold());
    }

    private void adaptThreshold(List<SampleStore.LabeledSample> samples) {
        if (samples.size() < 50) return;

        double[] scores = new double[samples.size()];
        for (int i = 0; i < samples.size(); i++) {
            scores[i] = currentModel.predictAnomalyScore(samples.get(i).features);
        }

        java.util.Arrays.sort(scores);
        int normalCount = 0;
        for (SampleStore.LabeledSample s : samples) {
            if (!s.isAnomaly) normalCount++;
        }

        if (normalCount > 0) {
            int percentile95Index = (int) (normalCount * 0.95);
            if (percentile95Index >= scores.length) percentile95Index = scores.length - 1;

            double normal95thPercentile = scores[percentile95Index];
            double newThreshold = Math.max(0.5, Math.min(0.9, normal95thPercentile * 1.2));

            currentModel.setAnomalyThreshold(newThreshold);
            logger.debug("Threshold adapted to {:.3f} based on recent normal samples", newThreshold);
        }
    }

    private int countAnomalies(boolean[] labels) {
        int count = 0;
        for (boolean label : labels) {
            if (label) count++;
        }
        return count;
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

    public void stop() {
        running = false;
        sampleStore.close();
        logger.info("Model Update Service stopped.");
    }

    public IsolationForestModel getCurrentModel() {
        return currentModel;
    }

    public static void main(String[] args) {
        String redisHost = args.length > 0 ? args[0] : "localhost";
        int redisPort = args.length > 1 ? Integer.parseInt(args[1]) : 6379;

        ModelUpdateService service = new ModelUpdateService(redisHost, redisPort);

        Runtime.getRuntime().addShutdownHook(new Thread(service::stop, "shutdown-hook"));

        service.start();
    }
}
