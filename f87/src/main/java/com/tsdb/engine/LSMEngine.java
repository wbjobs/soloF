package com.tsdb.engine;

import com.tsdb.compaction.SizeTieredCompaction;
import com.tsdb.memtable.MemTable;
import com.tsdb.model.DataPoint;
import com.tsdb.sstable.SSTable;
import com.tsdb.sstable.SSTableWriter;
import com.tsdb.wal.WAL;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class LSMEngine implements Closeable {
    private static final Logger logger = LoggerFactory.getLogger(LSMEngine.class);

    private final String dataDir;
    private final String walDir;
    private final long memtableMaxSize;
    private final int maxLevels = 4;

    private MemTable activeMemTable;
    private MemTable immutableMemTable;
    private final List<List<SSTable>> levels;

    private WAL wal;
    private final SizeTieredCompaction compaction;

    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private final AtomicBoolean running = new AtomicBoolean(true);
    private Thread compactionThread;
    private Thread flushThread;

    private final AtomicLong totalFlushBytes = new AtomicLong(0);
    private final AtomicLong totalWritePoints = new AtomicLong(0);

    private final Set<String> metrics = Collections.synchronizedSet(new LinkedHashSet<>());
    private final Set<String> seriesKeys = Collections.synchronizedSet(new LinkedHashSet<>());
    private final Map<String, Set<Long>> tombstones = new ConcurrentHashMap<>();

    public LSMEngine(String dataDir, String walDir, long memtableMaxSize,
                     int minSSTablesToCompact, int maxSSTablesToCompact, long maxLevelSize) throws IOException {
        this.dataDir = dataDir;
        this.walDir = walDir;
        this.memtableMaxSize = memtableMaxSize;

        Files.createDirectories(Paths.get(dataDir));
        Files.createDirectories(Paths.get(walDir));

        this.activeMemTable = new MemTable(memtableMaxSize);
        this.immutableMemTable = null;

        this.levels = new ArrayList<>();
        for (int i = 0; i < maxLevels; i++) {
            levels.add(new ArrayList<>());
        }

        this.compaction = new SizeTieredCompaction(dataDir, minSSTablesToCompact, maxSSTablesToCompact, maxLevelSize);

        this.wal = new WAL(walDir);

        loadExistingSSTables();
        recoverFromWAL();
        startBackgroundThreads();
    }

    private void loadExistingSSTables() throws IOException {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(Paths.get(dataDir), "sst_*.sst")) {
            for (Path file : stream) {
                String fileName = file.getFileName().toString();
                String[] parts = fileName.replace("sst_", "").replace(".sst", "").split("_");
                int level = Integer.parseInt(parts[0]);

                SSTable sstable = loadSSTableMetadata(file);
                if (level >= 0 && level < maxLevels) {
                    levels.get(level).add(sstable);
                    logger.info("Loaded SSTable: {} (level {}, {} entries)", fileName, level, sstable.getEntryCount());
                }
            }
        }

        for (List<SSTable> level : levels) {
            level.sort(Comparator.comparingLong(SSTable::getMinTimestamp));
        }
    }

    private SSTable loadSSTableMetadata(Path filePath) throws IOException {
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(filePath.toFile(), "r")) {
            long fileLength = raf.length();
            raf.seek(fileLength - 4);
            byte[] magic = new byte[4];
            raf.readFully(magic);
            if (!new String(magic).equals("TSDB")) {
                throw new IOException("Invalid SSTable file: " + filePath);
            }

            raf.seek(fileLength - 4 - 32);
            long indexOffset = raf.readLong();
            long minTimestamp = raf.readLong();
            long maxTimestamp = raf.readLong();
            long entryCount = raf.readLong();

            return new SSTable(filePath, minTimestamp, maxTimestamp, entryCount, fileLength);
        }
    }

    private void recoverFromWAL() throws IOException {
        List<DataPoint> recovered = wal.recover();
        if (!recovered.isEmpty()) {
            logger.info("Recovered {} data points from WAL", recovered.size());
            for (DataPoint dp : recovered) {
                activeMemTable.put(dp);
            }
        }
    }

    private void startBackgroundThreads() {
        compactionThread = new Thread(this::compactionLoop, "compaction-thread");
        compactionThread.setDaemon(true);
        compactionThread.start();

        flushThread = new Thread(this::flushLoop, "flush-thread");
        flushThread.setDaemon(true);
        flushThread.start();
    }

    public void write(DataPoint dataPoint) throws IOException {
        lock.writeLock().lock();
        try {
            wal.append(dataPoint);
            activeMemTable.put(dataPoint);
            totalWritePoints.incrementAndGet();
            metrics.add(dataPoint.getMetric());
            seriesKeys.add(dataPoint.getSeriesKey());

            if (activeMemTable.isFull()) {
                switchMemTable();
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void write(List<DataPoint> dataPoints) throws IOException {
        lock.writeLock().lock();
        try {
            for (DataPoint dp : dataPoints) {
                wal.append(dp);
                activeMemTable.put(dp);
                totalWritePoints.incrementAndGet();
                metrics.add(dp.getMetric());
                seriesKeys.add(dp.getSeriesKey());
            }

            if (activeMemTable.isFull()) {
                switchMemTable();
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    private void switchMemTable() throws IOException {
        if (immutableMemTable != null && !immutableMemTable.isEmpty()) {
            logger.warn("Immutable memtable not yet flushed, blocking writes");
            return;
        }

        immutableMemTable = activeMemTable;
        activeMemTable = new MemTable(memtableMaxSize);

        long currentWalFileId = wal.getCurrentFileId();
        wal.close();
        wal = new WAL(walDir);

        wal.deleteOldFiles(currentWalFileId);
    }

    private void flushLoop() {
        while (running.get()) {
            try {
                lock.writeLock().lock();
                try {
                    if (immutableMemTable != null && !immutableMemTable.isEmpty()) {
                        flushImmutableMemTable();
                    }
                } finally {
                    lock.writeLock().unlock();
                }

                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                logger.error("Error in flush loop", e);
            }
        }
    }

    private void flushImmutableMemTable() throws IOException {
        if (immutableMemTable == null || immutableMemTable.isEmpty()) {
            return;
        }

        logger.info("Flushing immutable memtable with {} entries", immutableMemTable.entryCount());

        long gen = compaction.getNextGeneration();
        SSTableWriter writer = new SSTableWriter(dataDir, 0, gen);

        Iterator<DataPoint> it = immutableMemTable.iterator();
        while (it.hasNext()) {
            writer.write(it.next());
        }

        SSTable sstable = writer.finish();
        writer.close();

        levels.get(0).add(sstable);
        immutableMemTable.clear();
        immutableMemTable = null;

        totalFlushBytes.addAndGet(sstable.getFileSize());
        logger.info("Flushed to SSTable: {} ({} bytes)", sstable.getFilePath().getFileName(), sstable.getFileSize());
    }

    private void compactionLoop() {
        long lastCheckTime = 0;
        long checkInterval = 30000;

        while (running.get()) {
            try {
                long now = System.currentTimeMillis();
                if (now - lastCheckTime >= checkInterval && compaction.shouldTriggerCompaction(levels)) {
                    lock.writeLock().lock();
                    try {
                        List<SizeTieredCompaction.CompactionResult> results = compaction.compact(levels);
                        for (SizeTieredCompaction.CompactionResult result : results) {
                            for (SSTable oldSSTable : result.getOldSSTables()) {
                                for (List<SSTable> level : levels) {
                                    level.remove(oldSSTable);
                                }
                                oldSSTable.delete();
                            }

                            if (result.getTargetLevel() < maxLevels) {
                                levels.get(result.getTargetLevel()).add(result.getNewSSTable());
                            } else {
                                levels.get(maxLevels - 1).add(result.getNewSSTable());
                            }
                        }
                        lastCheckTime = now;
                    } finally {
                        lock.writeLock().unlock();
                    }
                }

                Thread.sleep(10000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                logger.error("Error in compaction loop", e);
            }
        }
    }

    public List<DataPoint> rangeQuery(String metric, Map<String, String> tagsFilter, long startTime, long endTime) throws IOException {
        List<DataPoint> result = new ArrayList<>();

        lock.readLock().lock();
        try {
            result.addAll(activeMemTable.rangeQuery(metric, tagsFilter, startTime, endTime));

            if (immutableMemTable != null) {
                result.addAll(immutableMemTable.rangeQuery(metric, tagsFilter, startTime, endTime));
            }

            for (int level = 0; level < levels.size(); level++) {
                for (SSTable sstable : levels.get(level)) {
                    if (sstable.overlaps(startTime, endTime)) {
                        result.addAll(sstable.rangeQuery(metric, tagsFilter, startTime, endTime));
                    }
                }
            }

            if (!tombstones.isEmpty()) {
                result = filterTombstones(metric, tagsFilter, startTime, endTime, result);
            }
        } finally {
            lock.readLock().unlock();
        }

        result.sort(Comparator.comparingLong(DataPoint::getTimestamp));
        return result;
    }

    private List<DataPoint> filterTombstones(String metric, Map<String, String> tagsFilter,
                                              long startTime, long endTime, List<DataPoint> points) {
        if (points.isEmpty()) {
            return points;
        }

        List<DataPoint> filtered = new ArrayList<>();
        for (DataPoint dp : points) {
            String tombstoneKey = dp.getSeriesKey();
            Set<Long> deletedTimestamps = tombstones.get(tombstoneKey);
            if (deletedTimestamps == null || !deletedTimestamps.contains(dp.getTimestamp())) {
                filtered.add(dp);
            }
        }
        return filtered;
    }

    public Set<String> getMetrics() {
        return new LinkedHashSet<>(metrics);
    }

    public Set<String> getSeriesKeysForMetric(String metric) {
        Set<String> result = new LinkedHashSet<>();
        synchronized (seriesKeys) {
            for (String seriesKey : seriesKeys) {
                if (seriesKey.startsWith(metric + "{")) {
                    result.add(seriesKey);
                }
            }
        }
        return result;
    }

    public void deleteRange(String metric, Map<String, String> tagsFilter, long startTime, long endTime) throws IOException {
        lock.writeLock().lock();
        try {
            List<DataPoint> toDelete = rangeQuery(metric, tagsFilter, startTime, endTime);
            for (DataPoint dp : toDelete) {
                tombstones.computeIfAbsent(dp.getSeriesKey(), k -> Collections.synchronizedSet(new HashSet<>()))
                        .add(dp.getTimestamp());
            }
            logger.info("Marked {} points for deletion in range [{}, {}] for metric {}",
                    toDelete.size(), startTime, endTime, metric);

            if (tombstones.size() > 10000) {
                purgeTombstones();
            }
        } finally {
            lock.writeLock().unlock();
        }
    }

    private void purgeTombstones() throws IOException {
        if (tombstones.isEmpty()) {
            return;
        }
        logger.info("Purging tombstones from SSTables...");
        int removed = 0;
        for (List<SSTable> level : levels) {
            Iterator<SSTable> it = level.iterator();
            while (it.hasNext()) {
                SSTable sst = it.next();
                if (containsTombstonedData(sst)) {
                    rewriteSSTable(sst);
                    it.remove();
                    removed++;
                }
            }
        }
        tombstones.clear();
        logger.info("Purged {} SSTables, cleared tombstones", removed);
    }

    private boolean containsTombstonedData(SSTable sst) {
        for (String seriesKey : tombstones.keySet()) {
            int hashIndex = seriesKey.indexOf('{');
            if (hashIndex > 0) {
                return true;
            }
        }
        return false;
    }

    private void rewriteSSTable(SSTable sst) throws IOException {
        Iterator<DataPoint> it = sst.iterator();
        List<DataPoint> toKeep = new ArrayList<>();
        while (it.hasNext()) {
            DataPoint dp = it.next();
            Set<Long> deleted = tombstones.get(dp.getSeriesKey());
            if (deleted == null || !deleted.contains(dp.getTimestamp())) {
                toKeep.add(dp);
            }
        }

        if (!toKeep.isEmpty()) {
            long gen = compaction.getNextGeneration();
            SSTableWriter writer = new SSTableWriter(dataDir, 0, gen);
            for (DataPoint dp : toKeep) {
                writer.write(dp);
            }
            SSTable newSst = writer.finish();
            writer.close();
            levels.get(0).add(newSst);
        }

        sst.delete();
    }

    public EngineStats getStats() {
        EngineStats stats = new EngineStats();
        stats.activeMemTableSize = activeMemTable.size();
        stats.activeMemTableEntries = activeMemTable.entryCount();
        stats.immutableMemTableEntries = immutableMemTable != null ? immutableMemTable.entryCount() : 0;

        long totalSSTableSize = 0;
        long totalSSTableEntries = 0;
        for (int i = 0; i < levels.size(); i++) {
            List<SSTable> level = levels.get(i);
            long levelSize = level.stream().mapToLong(SSTable::getFileSize).sum();
            long levelEntries = level.stream().mapToLong(SSTable::getEntryCount).sum();
            stats.levelStats.add(new LevelStats(i, level.size(), levelSize, levelEntries));
            totalSSTableSize += levelSize;
            totalSSTableEntries += levelEntries;
        }

        stats.totalFlushBytes = totalFlushBytes.get();
        stats.totalWritePoints = totalWritePoints.get();
        stats.compactionBytesRead = compaction.getTotalBytesRead();
        stats.compactionBytesWritten = compaction.getTotalBytesWritten();
        stats.compactionCount = compaction.getCompactionCount();
        stats.writeAmplification = compaction.getWriteAmplification();
        stats.totalSSTableSize = totalSSTableSize;
        stats.totalSSTableEntries = totalSSTableEntries;

        return stats;
    }

    @Override
    public void close() throws IOException {
        running.set(false);

        try {
            if (compactionThread != null) {
                compactionThread.join(5000);
            }
            if (flushThread != null) {
                flushThread.join(5000);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        lock.writeLock().lock();
        try {
            if (immutableMemTable != null && !immutableMemTable.isEmpty()) {
                flushImmutableMemTable();
            }

            if (!activeMemTable.isEmpty()) {
                immutableMemTable = activeMemTable;
                flushImmutableMemTable();
            }

            wal.close();
        } finally {
            lock.writeLock().unlock();
        }

        logger.info("LSM Engine closed successfully");
    }

    public static class EngineStats {
        public long activeMemTableSize;
        public int activeMemTableEntries;
        public int immutableMemTableEntries;
        public List<LevelStats> levelStats = new ArrayList<>();

        public long totalFlushBytes;
        public long totalWritePoints;
        public long compactionBytesRead;
        public long compactionBytesWritten;
        public long compactionCount;
        public double writeAmplification;
        public long totalSSTableSize;
        public long totalSSTableEntries;
    }

    public static class LevelStats {
        public final int level;
        public final int sstableCount;
        public final long totalSize;
        public final long totalEntries;

        public LevelStats(int level, int sstableCount, long totalSize, long totalEntries) {
            this.level = level;
            this.sstableCount = sstableCount;
            this.totalSize = totalSize;
            this.totalEntries = totalEntries;
        }
    }
}
