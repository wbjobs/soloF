package com.fraud.ml;

import com.fraud.model.Transaction;
import org.apache.flink.api.common.state.ListState;
import org.apache.flink.api.common.state.ListStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class FeatureExtractor extends KeyedProcessFunction<String, Transaction, TransactionWithFeatures> {

    private transient ValueState<UserStats> userStatsState;
    private transient ListState<Double> recentAmountsState;
    private static final int MAX_RECENT_AMOUNTS = 50;

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

    @Override
    public void open(Configuration parameters) {
        ValueStateDescriptor<UserStats> userStatsDescriptor =
                new ValueStateDescriptor<>("user-stats", UserStats.class);
        userStatsState = getRuntimeContext().getState(userStatsDescriptor);

        ListStateDescriptor<Double> recentAmountsDescriptor =
                new ListStateDescriptor<>("recent-amounts", Double.class);
        recentAmountsState = getRuntimeContext().getListState(recentAmountsDescriptor);
    }

    @Override
    public void processElement(Transaction transaction, Context ctx, Collector<TransactionWithFeatures> out) throws Exception {
        UserStats userStats = userStatsState.value();
        if (userStats == null) {
            userStats = new UserStats();
        }

        List<Double> recentAmounts = new ArrayList<>();
        for (Double amount : recentAmountsState.get()) {
            recentAmounts.add(amount);
        }

        double[] features = extractFeatures(transaction, userStats, recentAmounts);

        updateUserStats(userStats, transaction);
        userStatsState.update(userStats);

        recentAmounts.add(transaction.getAmount());
        if (recentAmounts.size() > MAX_RECENT_AMOUNTS) {
            recentAmounts.remove(0);
        }
        recentAmountsState.update(recentAmounts);

        out.collect(new TransactionWithFeatures(transaction, features));
    }

    private double[] extractFeatures(Transaction tx, UserStats userStats, List<Double> recentAmounts) {
        double[] features = new double[28];
        int idx = 0;

        features[idx++] = tx.getAmount();
        features[idx++] = tx.getAmount() > 0 ? Math.log(tx.getAmount() + 1) : 0;

        double amountMean = userStats.totalTransactions > 0 ? userStats.sumAmount / userStats.totalTransactions : 0;
        double amountStd = userStats.totalTransactions > 1 ?
                Math.sqrt((userStats.sumSquaredAmount / userStats.totalTransactions) - (amountMean * amountMean)) : 0;
        features[idx++] = amountMean > 0 ? (tx.getAmount() - amountMean) / (amountStd + 1e-9) : 0;
        features[idx++] = amountMean > 0 ? tx.getAmount() / amountMean : 0;

        double recentMean = recentAmounts.isEmpty() ? 0 : recentAmounts.stream().mapToDouble(Double::doubleValue).average().getAsDouble();
        features[idx++] = recentMean > 0 ? tx.getAmount() / recentMean : 0;
        double recentMax = recentAmounts.isEmpty() ? 0 : recentAmounts.stream().mapToDouble(Double::doubleValue).max().getAsDouble();
        features[idx++] = recentMax > 0 ? tx.getAmount() / recentMax : 0;

        LocalDateTime time = tx.getTimestamp();
        features[idx++] = time.getHour();
        features[idx++] = time.getMinute();
        features[idx++] = time.getDayOfWeek().getValue();
        features[idx++] = time.getDayOfMonth();
        features[idx++] = time.getMonthValue();

        boolean isWeekend = time.getDayOfWeek() == DayOfWeek.SATURDAY || time.getDayOfWeek() == DayOfWeek.SUNDAY;
        features[idx++] = isWeekend ? 1 : 0;

        boolean isNight = time.getHour() >= 22 || time.getHour() < 6;
        features[idx++] = isNight ? 1 : 0;

        boolean isWorkHour = time.getHour() >= 9 && time.getHour() < 18 && !isWeekend;
        features[idx++] = isWorkHour ? 1 : 0;

        features[idx++] = encodeCity(tx.getCity());
        features[idx++] = encodePaymentMethod(tx.getPaymentMethod());
        features[idx++] = encodeMerchant(tx.getMerchant());

        features[idx++] = userStats.totalTransactions;
        features[idx++] = userStats.uniqueCities.size();
        features[idx++] = userStats.uniqueMerchants.size();

        long timeSinceLastTx = userStats.lastTransactionTime != null ?
                java.time.Duration.between(userStats.lastTransactionTime, time).toMillis() / 1000 : -1;
        features[idx++] = timeSinceLastTx;

        boolean sameCityAsLast = userStats.lastCity != null && userStats.lastCity.equals(tx.getCity());
        features[idx++] = sameCityAsLast ? 1 : 0;

        boolean sameMerchantAsLast = userStats.lastMerchant != null && userStats.lastMerchant.equals(tx.getMerchant());
        features[idx++] = sameMerchantAsLast ? 1 : 0;

        boolean samePaymentAsLast = userStats.lastPaymentMethod != null && userStats.lastPaymentMethod.equals(tx.getPaymentMethod());
        features[idx++] = samePaymentAsLast ? 1 : 0;

        long txInLastHour = userStats.getTransactionsInLastHour(time);
        features[idx++] = txInLastHour;

        long txInLastDay = userStats.getTransactionsInLastDay(time);
        features[idx++] = txInLastDay;

        double avgTxPerHour = txInLastDay > 0 ? (double) txInLastDay / 24 : 0;
        features[idx++] = avgTxPerHour > 0 ? (double) txInLastHour / avgTxPerHour : 0;

        double velocity = timeSinceLastTx > 0 ? (double) txInLastHour / Math.max(timeSinceLastTx, 60) * 3600 : 0;
        features[idx++] = velocity;

        double amountVelocity = timeSinceLastTx > 0 ? tx.getAmount() / Math.max(timeSinceLastTx, 1) : 0;
        features[idx++] = amountVelocity;

        while (idx < features.length) {
            features[idx++] = 0;
        }

        return features;
    }

    private void updateUserStats(UserStats stats, Transaction tx) {
        stats.totalTransactions++;
        stats.sumAmount += tx.getAmount();
        stats.sumSquaredAmount += tx.getAmount() * tx.getAmount();
        stats.lastTransactionTime = tx.getTimestamp();
        stats.lastCity = tx.getCity();
        stats.lastMerchant = tx.getMerchant();
        stats.lastPaymentMethod = tx.getPaymentMethod();
        stats.uniqueCities.add(tx.getCity());
        stats.uniqueMerchants.add(tx.getMerchant());
        stats.addTransaction(tx.getTimestamp());
    }

    private int encodeCity(String city) {
        return CITY_ENCODING.getOrDefault(city, CITY_ENCODING.get("其他"));
    }

    private int encodePaymentMethod(String method) {
        return PAYMENT_METHOD_ENCODING.getOrDefault(method, PAYMENT_METHOD_ENCODING.get("其他"));
    }

    private int encodeMerchant(String merchant) {
        return MERCHANT_ENCODING.getOrDefault(merchant, MERCHANT_ENCODING.get("其他"));
    }

    public static class UserStats implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        public long totalTransactions = 0;
        public double sumAmount = 0;
        public double sumSquaredAmount = 0;
        public LocalDateTime lastTransactionTime = null;
        public String lastCity = null;
        public String lastMerchant = null;
        public String lastPaymentMethod = null;
        public java.util.Set<String> uniqueCities = new java.util.HashSet<>();
        public java.util.Set<String> uniqueMerchants = new java.util.HashSet<>();
        public java.util.List<LocalDateTime> transactionTimes = new java.util.ArrayList<>();

        public void addTransaction(LocalDateTime time) {
            transactionTimes.add(time);
            if (transactionTimes.size() > 1000) {
                transactionTimes.remove(0);
            }
        }

        public long getTransactionsInLastHour(LocalDateTime current) {
            LocalDateTime oneHourAgo = current.minusHours(1);
            return transactionTimes.stream().filter(t -> t.isAfter(oneHourAgo)).count();
        }

        public long getTransactionsInLastDay(LocalDateTime current) {
            LocalDateTime oneDayAgo = current.minusDays(1);
            return transactionTimes.stream().filter(t -> t.isAfter(oneDayAgo)).count();
        }
    }

    public static class TransactionWithFeatures implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        public Transaction transaction;
        public double[] features;

        public TransactionWithFeatures() {}

        public TransactionWithFeatures(Transaction transaction, double[] features) {
            this.transaction = transaction;
            this.features = features;
        }
    }
}
