package com.simulator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

public class TransactionSimulator {

    private static final String[] CITIES = {
            "北京", "上海", "广州", "深圳", "杭州",
            "成都", "武汉", "南京", "西安", "重庆",
            "天津", "苏州", "青岛", "长沙", "郑州"
    };

    private static final String[] MERCHANTS = {
            "天猫商城", "京东自营", "拼多多", "美团外卖", "饿了么",
            "滴滴出行", "携程旅行", "淘宝", "唯品会", "苏宁易购",
            "盒马鲜生", "星巴克", "肯德基", "麦当劳", "海底捞"
    };

    private static final String[] PAYMENT_METHODS = {
            "支付宝", "微信支付", "银行卡", "信用卡", "花呗"
    };

    private static final String[] USER_IDS = generateUserIds(500);

    public static void main(String[] args) throws Exception {
        String kafkaBrokers = args.length > 0 ? args[0] : "localhost:9092";
        String topic = args.length > 1 ? args[1] : "transactions";
        long durationMs = args.length > 2 ? Long.parseLong(args[2]) : 600000;
        int ratePerSecond = args.length > 3 ? Integer.parseInt(args[3]) : 10;

        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaBrokers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.ACKS_CONFIG, "1");
        props.put(ProducerConfig.BATCH_SIZE_CONFIG, "16384");
        props.put(ProducerConfig.LINGER_MS_CONFIG, "10");

        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());

        Random random = new Random();
        long startTime = System.currentTimeMillis();
        long messageCount = 0;

        System.out.println("Starting transaction simulator...");
        System.out.println("Kafka Brokers: " + kafkaBrokers);
        System.out.println("Topic: " + topic);
        System.out.println("Duration: " + durationMs + "ms");
        System.out.println("Rate: " + ratePerSecond + " transactions/second");

        try (Producer<String, String> producer = new KafkaProducer<>(props)) {
            while (System.currentTimeMillis() - startTime < durationMs) {
                long batchStartTime = System.currentTimeMillis();

                for (int i = 0; i < ratePerSecond; i++) {
                    Map<String, Object> transaction = generateTransaction(random, messageCount);
                    String json = objectMapper.writeValueAsString(transaction);
                    String key = (String) transaction.get("userId");

                    ProducerRecord<String, String> record = new ProducerRecord<>(topic, key, json);
                    producer.send(record);
                    messageCount++;

                    if (messageCount % 1000 == 0) {
                        System.out.println("Sent " + messageCount + " transactions...");
                    }
                }

                long elapsed = System.currentTimeMillis() - batchStartTime;
                long sleepTime = Math.max(0, 1000 - elapsed);
                Thread.sleep(sleepTime);
            }

            producer.flush();
            System.out.println("Simulation completed. Total messages sent: " + messageCount);
        }
    }

    private static Map<String, Object> generateTransaction(Random random, long sequence) {
        Map<String, Object> transaction = new HashMap<>();

        boolean isAnomaly = random.nextInt(100) < 10;

        String userId = USER_IDS[random.nextInt(USER_IDS.length)];

        double amount;
        if (isAnomaly && random.nextBoolean()) {
            amount = 50000 + random.nextDouble() * 100000;
        } else {
            amount = 10 + random.nextDouble() * 5000;
        }
        amount = Math.round(amount * 100.0) / 100.0;

        String city;
        if (isAnomaly && random.nextBoolean()) {
            city = CITIES[random.nextInt(CITIES.length)];
        } else {
            city = CITIES[random.nextInt(3)];
        }

        transaction.put("transactionId", "TX-" + System.currentTimeMillis() + "-" + sequence);
        transaction.put("userId", userId);
        transaction.put("amount", amount);
        transaction.put("city", city);
        transaction.put("timestamp", LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
        transaction.put("merchant", MERCHANTS[random.nextInt(MERCHANTS.length)]);
        transaction.put("paymentMethod", PAYMENT_METHODS[random.nextInt(PAYMENT_METHODS.length)]);

        return transaction;
    }

    private static String[] generateUserIds(int count) {
        String[] userIds = new String[count];
        for (int i = 0; i < count; i++) {
            userIds[i] = "USER-" + String.format("%05d", i + 1);
        }
        return userIds;
    }
}
