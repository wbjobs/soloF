package com.tsdb.memtable;

import com.tsdb.model.DataPoint;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public class MemTable {
    private final SkipList<String, DataPoint> skipList;
    private long size;
    private final long maxSize;

    public MemTable(long maxSize) {
        this.skipList = new SkipList<>();
        this.size = 0;
        this.maxSize = maxSize;
    }

    public void put(DataPoint dataPoint) {
        String key = dataPoint.getSeriesKey() + "_" + dataPoint.getTimestamp();
        skipList.put(key, dataPoint);
        size += estimateSize(dataPoint);
    }

    public DataPoint get(String seriesKey, long timestamp) {
        String key = seriesKey + "_" + timestamp;
        return skipList.get(key);
    }

    public List<DataPoint> rangeQuery(String metric, Map<String, String> tagsFilter, long startTime, long endTime) {
        List<DataPoint> result = new ArrayList<>();
        Iterator<DataPoint> iterator = skipList.iterator();

        while (iterator.hasNext()) {
            DataPoint dp = iterator.next();
            if (dp.getMetric().equals(metric)
                    && dp.getTags().matches(tagsFilter)
                    && dp.getTimestamp() >= startTime
                    && dp.getTimestamp() <= endTime) {
                result.add(dp);
            }
        }

        return result;
    }

    public Iterator<DataPoint> iterator() {
        return skipList.iterator();
    }

    public boolean isFull() {
        return size >= maxSize;
    }

    public long size() {
        return size;
    }

    public int entryCount() {
        return skipList.size();
    }

    public boolean isEmpty() {
        return skipList.isEmpty();
    }

    private long estimateSize(DataPoint dataPoint) {
        long size = 8;
        size += dataPoint.getMetric().length() * 2L;
        size += dataPoint.getTags().getHashKey().length() * 2L;
        size += 8;
        size += 8;
        return size;
    }

    public void clear() {
        this.size = 0;
    }
}
