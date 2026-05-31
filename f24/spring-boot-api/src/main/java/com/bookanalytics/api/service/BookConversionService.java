package com.bookanalytics.api.service;

import com.bookanalytics.api.model.BookConversion;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class BookConversionService {

    private static final String REDIS_KEY_PREFIX = "book:conversion:";

    private final RedisTemplate<String, Object> redisTemplate;

    public BookConversionService(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public BookConversion getConversionByIsbn(String isbn) {
        String key = REDIS_KEY_PREFIX + isbn;
        Map<Object, Object> data = redisTemplate.opsForHash().entries(key);

        if (data.isEmpty()) {
            return new BookConversion(isbn, 0, 0, 0, 0.0, 0.0, System.currentTimeMillis());
        }

        try {
            long viewCount = Long.parseLong((String) data.getOrDefault("viewCount", "0"));
            long buyCount = Long.parseLong((String) data.getOrDefault("buyCount", "0"));
            long sellCount = Long.parseLong((String) data.getOrDefault("sellCount", "0"));
            double conversionRate = Double.parseDouble((String) data.getOrDefault("conversionRate", "0.0"));
            double sellBuyRatio = Double.parseDouble((String) data.getOrDefault("sellBuyRatio", "0.0"));
            long lastUpdate = Long.parseLong((String) data.getOrDefault("lastUpdate", "0"));

            return new BookConversion(isbn, viewCount, buyCount, sellCount, 
                                      conversionRate, sellBuyRatio, lastUpdate);
        } catch (Exception e) {
            return new BookConversion(isbn, 0, 0, 0, 0.0, 0.0, System.currentTimeMillis());
        }
    }

    public List<BookConversion> getTop10Conversion() {
        Set<String> keys = redisTemplate.keys(REDIS_KEY_PREFIX + "*");
        if (keys == null || keys.isEmpty()) {
            return Collections.emptyList();
        }

        List<BookConversion> allConversions = new ArrayList<>();
        for (String key : keys) {
            String isbn = key.substring(REDIS_KEY_PREFIX.length());
            BookConversion conversion = getConversionByIsbn(isbn);
            if (conversion.getViewCount() > 0 || conversion.getBuyCount() > 0) {
                allConversions.add(conversion);
            }
        }

        return allConversions.stream()
                .sorted(Comparator.comparingDouble(BookConversion::getConversionRate).reversed())
                .limit(10)
                .collect(Collectors.toList());
    }

    public List<BookConversion> getAllConversions() {
        Set<String> keys = redisTemplate.keys(REDIS_KEY_PREFIX + "*");
        if (keys == null || keys.isEmpty()) {
            return Collections.emptyList();
        }

        List<BookConversion> conversions = new ArrayList<>();
        for (String key : keys) {
            String isbn = key.substring(REDIS_KEY_PREFIX.length());
            conversions.add(getConversionByIsbn(isbn));
        }
        return conversions;
    }

    public Map<String, Long> getBehaviorSummary() {
        Set<String> keys = redisTemplate.keys(REDIS_KEY_PREFIX + "*");
        Map<String, Long> summary = new HashMap<>();
        summary.put("view", 0L);
        summary.put("buy", 0L);
        summary.put("sell", 0L);

        if (keys == null || keys.isEmpty()) {
            return summary;
        }

        for (String key : keys) {
            Map<Object, Object> data = redisTemplate.opsForHash().entries(key);
            summary.put("view", summary.get("view") + Long.parseLong((String) data.getOrDefault("viewCount", "0")));
            summary.put("buy", summary.get("buy") + Long.parseLong((String) data.getOrDefault("buyCount", "0")));
            summary.put("sell", summary.get("sell") + Long.parseLong((String) data.getOrDefault("sellCount", "0")));
        }

        return summary;
    }
}
