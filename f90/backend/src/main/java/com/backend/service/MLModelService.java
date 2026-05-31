package com.backend.service;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Service
public class MLModelService {

    private final RedisTemplate<String, Object> redisTemplate;

    private static final String LABELED_SAMPLES_KEY = "ml:labeled:samples";
    private static final String MODEL_KEY = "ml:model:current";
    private static final String MODEL_VERSION_KEY = "ml:model:version";
    private static final String TRAINING_QUEUE_KEY = "ml:training:queue";
    private static final String MODEL_METRICS_KEY = "ml:model:metrics";

    public MLModelService(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @PostConstruct
    public void init() {
    }

    public void addLabeledSample(String transactionId, String userId, double[] features,
                                 boolean isAnomaly, String annotator, String notes) {
        try {
            Map<String, Object> sample = new HashMap<>();
            sample.put("transactionId", transactionId);
            sample.put("userId", userId);
            sample.put("features", features);
            sample.put("isAnomaly", isAnomaly);
            sample.put("annotator", annotator);
            sample.put("notes", notes);
            sample.put("timestamp", System.currentTimeMillis());

            String sampleJson = serializeSample(sample);

            redisTemplate.opsForList().leftPush(LABELED_SAMPLES_KEY, sampleJson);
            redisTemplate.opsForList().trim(LABELED_SAMPLES_KEY, 0, 9999);

            redisTemplate.opsForList().leftPush(TRAINING_QUEUE_KEY, sampleJson);

            updateLabelStats(isAnomaly);
        } catch (Exception e) {
            throw new RuntimeException("Failed to add labeled sample", e);
        }
    }

    public Map<String, Object> getModelInfo() {
        Map<String, Object> modelInfo = new HashMap<>();

        Long version = getModelVersion();
        modelInfo.put("version", version);

        Long labeledCount = getLabeledSampleCount();
        modelInfo.put("labeledSampleCount", labeledCount);

        Long queueSize = redisTemplate.opsForList().size(TRAINING_QUEUE_KEY);
        modelInfo.put("trainingQueueSize", queueSize);

        Map<Object, Object> metrics = redisTemplate.opsForHash().entries(MODEL_METRICS_KEY);
        if (!metrics.isEmpty()) {
            modelInfo.put("metrics", metrics);
        }

        return modelInfo;
    }

    public List<Map<String, Object>> getRecentLabeledSamples(int count) {
        List<Map<String, Object>> samples = new ArrayList<>();
        List<Object> rawSamples = redisTemplate.opsForList().range(LABELED_SAMPLES_KEY, 0, count - 1);

        if (rawSamples != null) {
            for (Object raw : rawSamples) {
                try {
                    Map<String, Object> sample = deserializeSample((String) raw);
                    if (sample != null) {
                        samples.add(sample);
                    }
                } catch (Exception e) {
                }
            }
        }
        return samples;
    }

    public long getModelVersion() {
        Object version = redisTemplate.opsForValue().get(MODEL_VERSION_KEY);
        return version != null ? Long.parseLong(version.toString()) : 0;
    }

    public long getLabeledSampleCount() {
        Long count = redisTemplate.opsForList().size(LABELED_SAMPLES_KEY);
        return count != null ? count : 0;
    }

    public void triggerModelRetrain() {
        redisTemplate.convertAndSend("ml:model:retrain", "manual");
    }

    public void setModelThreshold(double threshold) {
        redisTemplate.opsForValue().set("ml:model:threshold", threshold);
    }

    public double getModelThreshold() {
        Object threshold = redisTemplate.opsForValue().get("ml:model:threshold");
        return threshold != null ? Double.parseDouble(threshold.toString()) : 0.7;
    }

    private void updateLabelStats(boolean isAnomaly) {
        String key = isAnomaly ? "ml:stats:anomaly:count" : "ml:stats:normal:count";
        redisTemplate.opsForValue().increment(key);
    }

    private String serializeSample(Map<String, Object> sample) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        DataOutputStream dos = new DataOutputStream(baos);

        dos.writeUTF((String) sample.get("transactionId"));
        dos.writeUTF((String) sample.get("userId"));
        double[] features = (double[]) sample.get("features");
        dos.writeInt(features.length);
        for (double v : features) {
            dos.writeDouble(v);
        }
        dos.writeBoolean((Boolean) sample.get("isAnomaly"));
        dos.writeUTF(sample.get("annotator") != null ? (String) sample.get("annotator") : "");
        dos.writeUTF(sample.get("notes") != null ? (String) sample.get("notes") : "");
        dos.writeLong((Long) sample.get("timestamp"));

        dos.flush();
        return Base64.getEncoder().encodeToString(baos.toByteArray());
    }

    private Map<String, Object> deserializeSample(String data) throws IOException {
        byte[] bytes = Base64.getDecoder().decode(data);
        ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
        DataInputStream dis = new DataInputStream(bais);

        Map<String, Object> sample = new HashMap<>();
        sample.put("transactionId", dis.readUTF());
        sample.put("userId", dis.readUTF());
        int featureCount = dis.readInt();
        double[] features = new double[featureCount];
        for (int i = 0; i < featureCount; i++) {
            features[i] = dis.readDouble();
        }
        sample.put("features", features);
        sample.put("isAnomaly", dis.readBoolean());
        sample.put("annotator", dis.readUTF());
        sample.put("notes", dis.readUTF());
        sample.put("timestamp", dis.readLong());

        return sample;
    }

    public static class ExtractedFeatures implements Serializable {
        private double[] features;

        public ExtractedFeatures(double[] features) {
            this.features = features;
        }

        public double[] getFeatures() {
            return features;
        }
    }

    public ExtractedFeatures extractFeatures(Map<String, Object> transactionData) {
        double[] features = new double[28];
        int idx = 0;

        double amount = transactionData.get("amount") != null ?
                ((Number) transactionData.get("amount")).doubleValue() : 0;
        features[idx++] = amount;
        features[idx++] = amount > 0 ? Math.log(amount + 1) : 0;

        Object historicalAvg = transactionData.get("historicalAmountAvg");
        Object historicalStd = transactionData.get("historicalAmountStd");
        if (historicalAvg != null && historicalStd != null) {
            double avg = ((Number) historicalAvg).doubleValue();
            double std = ((Number) historicalStd).doubleValue();
            features[idx++] = avg > 0 ? (amount - avg) / (std + 1e-9) : 0;
            features[idx++] = avg > 0 ? amount / avg : 0;
        } else {
            features[idx++] = 0;
            features[idx++] = 0;
        }

        Object recentAvg = transactionData.get("recentAmountAvg");
        Object recentMax = transactionData.get("recentAmountMax");
        if (recentAvg != null) {
            double avg = ((Number) recentAvg).doubleValue();
            features[idx++] = avg > 0 ? amount / avg : 0;
        } else {
            features[idx++] = 0;
        }
        if (recentMax != null) {
            double max = ((Number) recentMax).doubleValue();
            features[idx++] = max > 0 ? amount / max : 0;
        } else {
            features[idx++] = 0;
        }

        Object timestampObj = transactionData.get("timestamp");
        LocalDateTime time = timestampObj != null ?
                (timestampObj instanceof LocalDateTime ? (LocalDateTime) timestampObj :
                        LocalDateTime.parse(timestampObj.toString())) :
                LocalDateTime.now();

        features[idx++] = time.getHour();
        features[idx++] = time.getMinute();
        features[idx++] = time.getDayOfWeek().getValue();
        features[idx++] = time.getDayOfMonth();
        features[idx++] = time.getMonthValue();

        boolean isWeekend = time.getDayOfWeek().getValue() >= 6;
        features[idx++] = isWeekend ? 1 : 0;

        boolean isNight = time.getHour() >= 22 || time.getHour() < 6;
        features[idx++] = isNight ? 1 : 0;

        boolean isWorkHour = time.getHour() >= 9 && time.getHour() < 18 && !isWeekend;
        features[idx++] = isWorkHour ? 1 : 0;

        features[idx++] = encodeCity((String) transactionData.get("city"));
        features[idx++] = encodePaymentMethod((String) transactionData.get("paymentMethod"));
        features[idx++] = encodeMerchant((String) transactionData.get("merchant"));

        Object totalTx = transactionData.get("totalTransactions");
        features[idx++] = totalTx != null ? ((Number) totalTx).longValue() : 0;

        Object uniqueCities = transactionData.get("uniqueCities");
        features[idx++] = uniqueCities != null ? ((Collection) uniqueCities).size() : 0;

        Object uniqueMerchants = transactionData.get("uniqueMerchants");
        features[idx++] = uniqueMerchants != null ? ((Collection) uniqueMerchants).size() : 0;

        Object timeSinceLastTx = transactionData.get("timeSinceLastTxSeconds");
        features[idx++] = timeSinceLastTx != null ? ((Number) timeSinceLastTx).longValue() : -1;

        Object sameCityAsLast = transactionData.get("sameCityAsLast");
        features[idx++] = Boolean.TRUE.equals(sameCityAsLast) ? 1 : 0;

        Object sameMerchantAsLast = transactionData.get("sameMerchantAsLast");
        features[idx++] = Boolean.TRUE.equals(sameMerchantAsLast) ? 1 : 0;

        Object samePaymentAsLast = transactionData.get("samePaymentAsLast");
        features[idx++] = Boolean.TRUE.equals(samePaymentAsLast) ? 1 : 0;

        Object txInLastHour = transactionData.get("txInLastHour");
        features[idx++] = txInLastHour != null ? ((Number) txInLastHour).longValue() : 0;

        Object txInLastDay = transactionData.get("txInLastDay");
        features[idx++] = txInLastDay != null ? ((Number) txInLastDay).longValue() : 0;

        Object avgTxPerHour = transactionData.get("avgTxPerHour");
        Object currentHourlyRate = transactionData.get("currentHourlyRate");
        if (avgTxPerHour != null && currentHourlyRate != null) {
            double avg = ((Number) avgTxPerHour).doubleValue();
            double current = ((Number) currentHourlyRate).doubleValue();
            features[idx++] = avg > 0 ? current / avg : 0;
        } else {
            features[idx++] = 0;
        }

        Object velocity = transactionData.get("velocity");
        features[idx++] = velocity != null ? ((Number) velocity).doubleValue() : 0;

        Object amountVelocity = transactionData.get("amountVelocity");
        features[idx++] = amountVelocity != null ? ((Number) amountVelocity).doubleValue() : 0;

        while (idx < features.length) {
            features[idx++] = 0;
        }

        return new ExtractedFeatures(features);
    }

    private static final Map<String, Integer> CITY_ENCODING = new HashMap<>();
    private static final Map<String, Integer> PAYMENT_METHOD_ENCODING = new HashMap<>();
    private static final Map<String, Integer> MERCHANT_ENCODING = new HashMap<>();

    static {
        String[] cities = {"北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆",
                "天津", "苏州", "青岛", "长沙", "郑州", "其他"};
        for (int i = 0; i < cities.length; i++) {
            CITY_ENCODING.put(cities[i], i);
        }

        String[] paymentMethods = {"支付宝", "微信支付", "银行卡", "信用卡", "花呗", "其他"};
        for (int i = 0; i < paymentMethods.length; i++) {
            PAYMENT_METHOD_ENCODING.put(paymentMethods[i], i);
        }

        String[] merchants = {"天猫商城", "京东自营", "拼多多", "美团外卖", "饿了么",
                "滴滴出行", "携程旅行", "淘宝", "唯品会", "苏宁易购",
                "盒马鲜生", "星巴克", "肯德基", "麦当劳", "海底捞", "其他"};
        for (int i = 0; i < merchants.length; i++) {
            MERCHANT_ENCODING.put(merchants[i], i);
        }
    }

    private int encodeCity(String city) {
        return city != null ? CITY_ENCODING.getOrDefault(city, CITY_ENCODING.get("其他")) : CITY_ENCODING.get("其他");
    }

    private int encodePaymentMethod(String method) {
        return method != null ? PAYMENT_METHOD_ENCODING.getOrDefault(method, PAYMENT_METHOD_ENCODING.get("其他"))
                : PAYMENT_METHOD_ENCODING.get("其他");
    }

    private int encodeMerchant(String merchant) {
        return merchant != null ? MERCHANT_ENCODING.getOrDefault(merchant, MERCHANT_ENCODING.get("其他"))
                : MERCHANT_ENCODING.get("其他");
    }
}
