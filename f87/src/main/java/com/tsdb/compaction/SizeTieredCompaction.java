package com.tsdb.compaction;

import com.tsdb.model.DataPoint;
import com.tsdb.sstable.SSTable;
import com.tsdb.sstable.SSTableWriter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

public class SizeTieredCompaction {
    private static final Logger logger = LoggerFactory.getLogger(SizeTieredCompaction.class);

    private final String dataDir;
    private final int minSSTablesToCompact;
    private final int maxSSTablesToCompact;
    private final long maxLevelSize;
    private final AtomicLong generation;
    private final int maxLevels = 4;

    private final AtomicLong totalBytesWritten = new AtomicLong(0);
    private final AtomicLong totalBytesRead = new AtomicLong(0);
    private final AtomicLong compactionCount = new AtomicLong(0);

    public SizeTieredCompaction(String dataDir, int minSSTablesToCompact, int maxSSTablesToCompact, long maxLevelSize) {
        this.dataDir = dataDir;
        this.minSSTablesToCompact = Math.max(minSSTablesToCompact, 8);
        this.maxSSTablesToCompact = Math.min(Math.max(maxSSTablesToCompact, 16), 32);
        this.maxLevelSize = maxLevelSize;
        this.generation = new AtomicLong(System.currentTimeMillis());
    }

    public List<CompactionResult> compact(List<List<SSTable>> levels) throws IOException {
        List<CompactionResult> results = new ArrayList<>();

        int levelToCompact = findLevelToCompact(levels);
        if (levelToCompact < 0 || levelToCompact >= levels.size() - 1) {
            return results;
        }

        List<SSTable> currentLevel = levels.get(levelToCompact);
        List<SSTable> toCompact = selectSSTablesForCompaction(currentLevel);

        if (toCompact.size() >= minSSTablesToCompact) {
            CompactionResult result = performCompaction(toCompact, levelToCompact + 1);
            results.add(result);

            long bytesRead = toCompact.stream().mapToLong(SSTable::getFileSize).sum();
            long bytesWritten = result.getNewSSTable().getFileSize();

            totalBytesRead.addAndGet(bytesRead);
            totalBytesWritten.addAndGet(bytesWritten);
            compactionCount.incrementAndGet();

            double writeAmp = bytesWritten * 1.0 / bytesRead;
            logger.info("Compacted {} SSTables ({} bytes) from level {} to level {} -> {} bytes (amp={:.2f})",
                    toCompact.size(), bytesRead, levelToCompact, levelToCompact + 1, bytesWritten, writeAmp);
        }

        return results;
    }

    private int findLevelToCompact(List<List<SSTable>> levels) {
        double maxScore = 0;
        int bestLevel = -1;

        for (int level = 0; level < levels.size() - 1; level++) {
            List<SSTable> sstables = levels.get(level);
            long totalSize = sstables.stream().mapToLong(SSTable::getFileSize).sum();

            long levelThreshold = maxLevelSize * (long) Math.pow(10, level);

            double sizeScore = (double) totalSize / levelThreshold;
            double countScore = (double) sstables.size() / minSSTablesToCompact;

            double score = Math.max(sizeScore, countScore) * (1.0 - level * 0.1);

            if (sstables.size() >= minSSTablesToCompact && score > maxScore && score >= 0.8) {
                maxScore = score;
                bestLevel = level;
            }
        }

        return bestLevel;
    }

    private List<SSTable> selectSSTablesForCompaction(List<SSTable> sstables) {
        if (sstables.size() < minSSTablesToCompact) {
            return Collections.emptyList();
        }

        List<SSTable> sorted = new ArrayList<>(sstables);
        sorted.sort(Comparator.comparingLong(SSTable::getFileSize));

        List<List<SSTable>> buckets = new ArrayList<>();
        for (SSTable sstable : sorted) {
            boolean added = false;
            for (List<SSTable> bucket : buckets) {
                long bucketSize = bucket.get(0).getFileSize();
                long sstableSize = sstable.getFileSize();
                if (Math.abs(bucketSize - sstableSize) <= Math.max(bucketSize, sstableSize) * 0.4
                        && bucket.size() < maxSSTablesToCompact) {
                    bucket.add(sstable);
                    added = true;
                    break;
                }
            }
            if (!added) {
                List<SSTable> newBucket = new ArrayList<>();
                newBucket.add(sstable);
                buckets.add(newBucket);
            }
        }

        List<SSTable> selected = Collections.emptyList();
        int maxBucketSize = 0;
        for (List<SSTable> bucket : buckets) {
            if (bucket.size() >= minSSTablesToCompact && bucket.size() > maxBucketSize) {
                maxBucketSize = bucket.size();
                selected = bucket;
            }
        }

        return selected;
    }

    private CompactionResult performCompaction(List<SSTable> sstables, int targetLevel) throws IOException {
        if (sstables.isEmpty()) {
            throw new IllegalArgumentException("No SSTables to compact");
        }

        List<Iterator<DataPoint>> iterators = new ArrayList<>();
        for (SSTable sstable : sstables) {
            iterators.add(sstable.iterator());
        }

        PriorityQueue<QueueEntry> minHeap = new PriorityQueue<>(
                Comparator.comparing((QueueEntry qe) -> qe.dataPoint.getSeriesKey())
                        .thenComparingLong(qe -> qe.dataPoint.getTimestamp())
        );

        for (int i = 0; i < iterators.size(); i++) {
            Iterator<DataPoint> it = iterators.get(i);
            if (it.hasNext()) {
                minHeap.add(new QueueEntry(it.next(), it, i));
            }
        }

        long gen = generation.incrementAndGet();
        SSTableWriter writer = new SSTableWriter(dataDir, targetLevel, gen);

        DataPoint last = null;
        while (!minHeap.isEmpty()) {
            QueueEntry entry = minHeap.poll();
            DataPoint current = entry.dataPoint;

            if (last == null || !current.getSeriesKey().equals(last.getSeriesKey())
                    || current.getTimestamp() != last.getTimestamp()) {
                writer.write(current);
                last = current;
            }

            if (entry.iterator.hasNext()) {
                minHeap.add(new QueueEntry(entry.iterator.next(), entry.iterator, entry.sourceIndex));
            }
        }

        SSTable newSSTable = writer.finish();
        writer.close();

        return new CompactionResult(newSSTable, sstables, targetLevel);
    }

    public boolean shouldTriggerCompaction(List<List<SSTable>> levels) {
        for (int level = 0; level < levels.size(); level++) {
            List<SSTable> sstables = levels.get(level);
            long totalSize = 0;
            for (SSTable sst : sstables) {
                totalSize += sst.getFileSize();
            }

            long levelThreshold = maxLevelSize * (long) Math.pow(10, level);
            int countThreshold = level == 0 ? minSSTablesToCompact : minSSTablesToCompact + level * 4;

            if (sstables.size() >= countThreshold || totalSize >= levelThreshold) {
                return true;
            }
        }
        return false;
    }

    public long getNextGeneration() {
        return generation.incrementAndGet();
    }

    public long getTotalBytesWritten() {
        return totalBytesWritten.get();
    }

    public long getTotalBytesRead() {
        return totalBytesRead.get();
    }

    public long getCompactionCount() {
        return compactionCount.get();
    }

    public double getWriteAmplification() {
        long read = totalBytesRead.get();
        if (read == 0) {
            return 0;
        }
        return totalBytesWritten.get() * 1.0 / read;
    }

    private static class QueueEntry {
        DataPoint dataPoint;
        Iterator<DataPoint> iterator;
        int sourceIndex;

        QueueEntry(DataPoint dataPoint, Iterator<DataPoint> iterator, int sourceIndex) {
            this.dataPoint = dataPoint;
            this.iterator = iterator;
            this.sourceIndex = sourceIndex;
        }
    }

    public static class CompactionResult {
        private final SSTable newSSTable;
        private final List<SSTable> oldSSTables;
        private final int targetLevel;

        public CompactionResult(SSTable newSSTable, List<SSTable> oldSSTables, int targetLevel) {
            this.newSSTable = newSSTable;
            this.oldSSTables = oldSSTables;
            this.targetLevel = targetLevel;
        }

        public SSTable getNewSSTable() {
            return newSSTable;
        }

        public List<SSTable> getOldSSTables() {
            return oldSSTables;
        }

        public int getTargetLevel() {
            return targetLevel;
        }
    }
}
