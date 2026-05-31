package com.fraud.ml;

import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.source.RichSourceFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ModelBroadcastSource extends RichSourceFunction<IsolationForestModel> {
    private static final Logger logger = LoggerFactory.getLogger(ModelBroadcastSource.class);
    private static final long POLL_INTERVAL_MS = 30 * 1000;

    private final String redisHost;
    private final int redisPort;
    private transient SampleStore sampleStore;
    private volatile boolean running;
    private long lastModelVersion;

    public ModelBroadcastSource(String redisHost, int redisPort) {
        this.redisHost = redisHost;
        this.redisPort = redisPort;
        this.lastModelVersion = -1;
    }

    @Override
    public void open(Configuration parameters) {
        sampleStore = new SampleStore(redisHost, redisPort);
        running = true;
    }

    @Override
    public void run(SourceContext<IsolationForestModel> ctx) throws Exception {
        logger.info("Model broadcast source started. Polling every {}s", POLL_INTERVAL_MS / 1000);

        while (running) {
            try {
                long currentVersion = sampleStore.getModelVersion();

                if (currentVersion > lastModelVersion) {
                    IsolationForestModel model = sampleStore.loadModel();
                    if (model != null) {
                        synchronized (ctx.getCheckpointLock()) {
                            ctx.collect(model);
                            lastModelVersion = currentVersion;
                            logger.info("Broadcasted updated model. Version: {}, Total samples: {}",
                                    lastModelVersion, model.getTotalSamples());
                        }
                    }
                }

                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                logger.info("Model broadcast source interrupted");
                break;
            } catch (Exception e) {
                logger.error("Error polling for model updates", e);
                Thread.sleep(POLL_INTERVAL_MS);
            }
        }
    }

    @Override
    public void cancel() {
        running = false;
        if (sampleStore != null) {
            sampleStore.close();
        }
    }
}
