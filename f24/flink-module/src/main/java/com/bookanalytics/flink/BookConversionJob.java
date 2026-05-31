package com.bookanalytics.flink;

import com.bookanalytics.flink.model.BookBehavior;
import com.bookanalytics.flink.model.BookConversionAccumulator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.api.common.functions.RichMapFunction;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.CheckpointingMode;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.streaming.api.functions.sink.RichSinkFunction;
import org.apache.flink.streaming.connectors.kafka.FlinkKafkaConsumer;
import org.apache.flink.util.Collector;
import redis.clients.jedis.Jedis;

import java.util.Properties;
import java.util.concurrent.TimeUnit;

public class BookConversionJob {

    private static final String KAFKA_TOPIC = "book_behavior";
    private static final String REDIS_HOST = "localhost";
    private static final int REDIS_PORT = 6379;
    private static final String REDIS_KEY_PREFIX = "book:conversion:";

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        // 启用Checkpoint，间隔10秒，EXACTLY_ONCE语义
        env.enableCheckpointing(10000, CheckpointingMode.EXACTLY_ONCE);
        env.getCheckpointConfig().setCheckpointTimeout(60000);
        env.getCheckpointConfig().setMaxConcurrentCheckpoints(1);
        env.getCheckpointConfig().setMinPauseBetweenCheckpoints(5000);
        env.getCheckpointConfig().enableExternalizedCheckpoints(
                org.apache.flink.streaming.api.environment.CheckpointConfig.ExternalizedCheckpointCleanup.RETAIN_ON_CANCELLATION
        );

        // 设置重启策略 - 固定间隔重启
        env.setRestartStrategy(org.apache.flink.api.common.restartstrategy.RestartStrategies.fixedDelayRestart(
                3, Time.of(10, TimeUnit.SECONDS)
        ));

        Properties kafkaProps = new Properties();
        kafkaProps.setProperty("bootstrap.servers", "localhost:9092");
        kafkaProps.setProperty("group.id", "book-conversion-group");
        
        // 关键：Kafka消费者配置，确保重启后从上次提交的偏移量继续
        kafkaProps.setProperty("auto.offset.reset", "latest");
        kafkaProps.setProperty("enable.auto.commit", "false");

        FlinkKafkaConsumer<String> kafkaConsumer = new FlinkKafkaConsumer<>(
                KAFKA_TOPIC,
                new SimpleStringSchema(),
                kafkaProps
        );

        // 让Flink管理偏移量提交，与Checkpoint绑定
        kafkaConsumer.setCommitOffsetsOnCheckpoints(true);

        DataStream<String> kafkaStream = env.addSource(kafkaConsumer);

        ObjectMapper objectMapper = new ObjectMapper();
        SingleOutputStreamOperator<BookBehavior> behaviorStream = kafkaStream
                .map((MapFunction<String, BookBehavior>) value -> {
                    try {
                        String[] parts = value.split(",");
                        if (parts.length >= 4) {
                            return new BookBehavior(
                                    parts[0].trim(),
                                    parts[1].trim(),
                                    parts[2].trim(),
                                    Long.parseLong(parts[3].trim())
                            );
                        }
                        return objectMapper.readValue(value, BookBehavior.class);
                    } catch (Exception e) {
                        return null;
                    }
                })
                .filter(behavior -> behavior != null && behavior.getIsbn() != null);

        // 使用KeyedProcessFunction进行有状态计算
        SingleOutputStreamOperator<BookConversionAccumulator> conversionStream = behaviorStream
                .keyBy(BookBehavior::getIsbn)
                .process(new BookConversionProcessFunction());

        conversionStream.addSink(new RedisSink());

        env.execute("Book Conversion Rate Job");
    }

    public static class BookConversionProcessFunction 
            extends KeyedProcessFunction<String, BookBehavior, BookConversionAccumulator> {

        private transient ValueState<BookConversionAccumulator> state;
        private transient ValueState<Long> lastEmitTimeState;
        private static final long EMIT_INTERVAL = 5000; // 5秒输出一次

        @Override
        public void open(Configuration parameters) throws Exception {
            ValueStateDescriptor<BookConversionAccumulator> descriptor =
                    new ValueStateDescriptor<>(
                            "conversionState",
                            BookConversionAccumulator.class
                    );
            // 设置状态TTL，24小时过期
            descriptor.enableTimeToLive(org.apache.flink.api.common.state.StateTtlConfig
                    .newBuilder(org.apache.flink.api.common.time.Time.hours(24))
                    .setUpdateType(org.apache.flink.api.common.state.StateTtlConfig.UpdateType.OnCreateAndWrite)
                    .setStateVisibility(org.apache.flink.api.common.state.StateTtlConfig.StateVisibility.NeverReturnExpired)
                    .build());
            state = getRuntimeContext().getState(descriptor);

            ValueStateDescriptor<Long> lastEmitDescriptor =
                    new ValueStateDescriptor<>("lastEmitTime", Long.class);
            lastEmitTimeState = getRuntimeContext().getState(lastEmitDescriptor);
        }

        @Override
        public void processElement(
                BookBehavior behavior,
                Context context,
                Collector<BookConversionAccumulator> collector) throws Exception {

            // 获取当前状态
            BookConversionAccumulator accumulator = state.value();
            if (accumulator == null) {
                accumulator = new BookConversionAccumulator();
                accumulator.setIsbn(context.getCurrentKey());
            }

            // 更新状态
            if ("view".equalsIgnoreCase(behavior.getBehaviorType())) {
                accumulator.addView();
            } else if ("buy".equalsIgnoreCase(behavior.getBehaviorType())) {
                accumulator.addBuy();
            } else if ("sell".equalsIgnoreCase(behavior.getBehaviorType())) {
                accumulator.addSell();
            }

            // 更新状态
            state.update(accumulator);

            // 限流：每5秒才输出一次
            Long lastEmitTime = lastEmitTimeState.value();
            long currentTime = System.currentTimeMillis();
            if (lastEmitTime == null || currentTime - lastEmitTime >= EMIT_INTERVAL) {
                collector.collect(accumulator);
                lastEmitTimeState.update(currentTime);
            }
        }
    }

    public static class RedisSink extends RichSinkFunction<BookConversionAccumulator> {
        private transient Jedis jedis;

        @Override
        public void open(Configuration parameters) throws Exception {
            super.open(parameters);
            try {
                jedis = new Jedis(REDIS_HOST, REDIS_PORT);
                jedis.connect();
            } catch (Exception e) {
                throw new RuntimeException("无法连接到Redis", e);
            }
        }

        @Override
        public void invoke(BookConversionAccumulator value, Context context) throws Exception {
            if (jedis == null || !jedis.isConnected()) {
                try {
                    jedis = new Jedis(REDIS_HOST, REDIS_PORT);
                } catch (Exception e) {
                    return;
                }
            }

            try {
                String key = REDIS_KEY_PREFIX + value.getIsbn();
                
                if (value.getViewCount() > 0) {
                    jedis.hset(key, "viewCount", String.valueOf(value.getViewCount()));
                }
                if (value.getBuyCount() > 0) {
                    jedis.hset(key, "buyCount", String.valueOf(value.getBuyCount()));
                }
                if (value.getSellCount() > 0) {
                    jedis.hset(key, "sellCount", String.valueOf(value.getSellCount()));
                }
                
                double conversionRate = value.getConversionRate();
                double sellBuyRatio = value.getSellBuyRatio();
                jedis.hset(key, "conversionRate", String.format("%.4f", conversionRate));
                jedis.hset(key, "sellBuyRatio", String.format("%.4f", sellBuyRatio));
                jedis.hset(key, "lastUpdate", String.valueOf(System.currentTimeMillis()));
                jedis.expire(key, 86400);
            } catch (Exception e) {
            }
        }

        @Override
        public void close() throws Exception {
            super.close();
            if (jedis != null) {
                try {
                    jedis.close();
                } catch (Exception e) {
                }
            }
        }
    }
}
