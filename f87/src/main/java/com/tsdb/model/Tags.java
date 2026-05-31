package com.tsdb.model;

import java.io.Serializable;
import java.util.*;

public class Tags implements Serializable {
    private static final long serialVersionUID = 1L;

    private final Map<String, String> tags;
    private transient String hashKey;

    public Tags() {
        this.tags = new LinkedHashMap<>();
    }

    public Tags(Map<String, String> tags) {
        this.tags = new LinkedHashMap<>(tags);
    }

    public static Tags of(String... keyValues) {
        Tags tags = new Tags();
        for (int i = 0; i < keyValues.length; i += 2) {
            if (i + 1 < keyValues.length) {
                tags.put(keyValues[i], keyValues[i + 1]);
            }
        }
        return tags;
    }

    public void put(String key, String value) {
        tags.put(key, value);
        hashKey = null;
    }

    public String get(String key) {
        return tags.get(key);
    }

    public Map<String, String> getTags() {
        return Collections.unmodifiableMap(tags);
    }

    public Set<Map.Entry<String, String>> entrySet() {
        return tags.entrySet();
    }

    public String getHashKey() {
        if (hashKey == null) {
            StringBuilder sb = new StringBuilder();
            List<String> keys = new ArrayList<>(tags.keySet());
            Collections.sort(keys);
            for (String key : keys) {
                sb.append(key).append("=").append(tags.get(key)).append(",");
            }
            hashKey = sb.toString();
        }
        return hashKey;
    }

    public boolean matches(Map<String, String> filter) {
        if (filter == null || filter.isEmpty()) {
            return true;
        }
        for (Map.Entry<String, String> entry : filter.entrySet()) {
            String value = tags.get(entry.getKey());
            if (value == null || !value.equals(entry.getValue())) {
                return false;
            }
        }
        return true;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Tags tags1 = (Tags) o;
        return Objects.equals(tags, tags1.tags);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tags);
    }

    @Override
    public String toString() {
        return tags.toString();
    }
}
