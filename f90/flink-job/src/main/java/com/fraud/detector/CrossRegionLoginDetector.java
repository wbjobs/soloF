package com.fraud.detector;

import com.fraud.model.Alert;
import com.fraud.model.Transaction;
import org.apache.flink.api.common.state.ListState;
import org.apache.flink.api.common.state.ListStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;

public class CrossRegionLoginDetector extends KeyedProcessFunction<String, Transaction, Transaction> {

    private final OutputTag<Alert> alertOutputTag;
    private transient ListState<LocationRecord> locationHistoryState;
    private static final long TIME_WINDOW_MINUTES = 5;
    private static final int MAX_HISTORY_SIZE = 10;

    public CrossRegionLoginDetector(OutputTag<Alert> alertOutputTag) {
        this.alertOutputTag = alertOutputTag;
    }

    @Override
    public void open(Configuration parameters) {
        ListStateDescriptor<LocationRecord> locationDescriptor =
                new ListStateDescriptor<>("location-history", LocationRecord.class);
        locationHistoryState = getRuntimeContext().getListState(locationDescriptor);
    }

    @Override
    public void processElement(Transaction transaction, Context ctx, Collector<Transaction> out) throws Exception {
        LocalDateTime currentTime = transaction.getTimestamp();
        String currentCity = transaction.getCity();

        List<LocationRecord> recentLocations = new ArrayList<>();
        List<LocationRecord> validLocations = new ArrayList<>();

        Iterator<LocationRecord> iterator = locationHistoryState.get().iterator();
        while (iterator.hasNext()) {
            LocationRecord record = iterator.next();
            Duration duration = Duration.between(record.timestamp, currentTime);
            if (duration.toMinutes() <= TIME_WINDOW_MINUTES) {
                recentLocations.add(record);
                validLocations.add(record);
            }
        }

        boolean isCrossRegion = false;
        LocationRecord crossRegionRecord = null;
        for (LocationRecord recent : recentLocations) {
            if (!recent.city.equalsIgnoreCase(currentCity)) {
                isCrossRegion = true;
                crossRegionRecord = recent;
                break;
            }
        }

        if (isCrossRegion && crossRegionRecord != null) {
            Alert alert = new Alert(
                    UUID.randomUUID().toString(),
                    transaction.getUserId(),
                    "CROSS_REGION_LOGIN",
                    "跨地域短时登录检测: 5分钟内在不同城市登录 - " +
                            crossRegionRecord.city + " -> " + currentCity,
                    "CRITICAL",
                    transaction.getTransactionId(),
                    transaction.getTimestamp(),
                    "城市1: " + crossRegionRecord.city +
                            ", 时间1: " + crossRegionRecord.timestamp +
                            ", 城市2: " + currentCity +
                            ", 时间2: " + currentTime +
                            ", 时间差: " + Duration.between(crossRegionRecord.timestamp, currentTime).toMinutes() + "分钟"
            );
            ctx.output(alertOutputTag, alert);
        }

        LocationRecord currentRecord = new LocationRecord(currentCity, currentTime);
        validLocations.add(currentRecord);

        if (validLocations.size() > MAX_HISTORY_SIZE) {
            validLocations = new ArrayList<>(
                    validLocations.subList(validLocations.size() - MAX_HISTORY_SIZE, validLocations.size())
            );
        }

        locationHistoryState.update(validLocations);
        out.collect(transaction);
    }

    public static class LocationRecord implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        public String city;
        public LocalDateTime timestamp;

        public LocationRecord() {}

        public LocationRecord(String city, LocalDateTime timestamp) {
            this.city = city;
            this.timestamp = timestamp;
        }
    }
}
