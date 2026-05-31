package com.tsdb.sstable;

import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;
import org.xerial.snappy.Snappy;

import java.io.*;
import java.nio.file.Path;
import java.util.*;
import java.util.zip.CRC32;

public class SSTable {
    private final Path filePath;
    private final long minTimestamp;
    private final long maxTimestamp;
    private final long entryCount;
    private final long fileSize;
    private List<SSTableWriter.IndexEntry> index;
    private long indexOffset;
    private final Object lock = new Object();
    private boolean indexLoaded = false;

    public SSTable(Path filePath, long minTimestamp, long maxTimestamp, long entryCount, long fileSize) {
        this.filePath = filePath;
        this.minTimestamp = minTimestamp;
        this.maxTimestamp = maxTimestamp;
        this.entryCount = entryCount;
        this.fileSize = fileSize;
    }

    public Path getFilePath() {
        return filePath;
    }

    public long getMinTimestamp() {
        return minTimestamp;
    }

    public long getMaxTimestamp() {
        return maxTimestamp;
    }

    public long getEntryCount() {
        return entryCount;
    }

    public long getFileSize() {
        return fileSize;
    }

    public boolean overlaps(long startTime, long endTime) {
        return !(maxTimestamp < startTime || minTimestamp > endTime);
    }

    private void loadIndex() throws IOException {
        if (indexLoaded) {
            return;
        }
        synchronized (lock) {
            if (indexLoaded) {
                return;
            }
            try (RandomAccessFile raf = new RandomAccessFile(filePath.toFile(), "r")) {
                long fileLength = raf.length();
                raf.seek(fileLength - 4);
                byte[] magic = new byte[4];
                raf.readFully(magic);
                if (!new String(magic).equals("TSDB")) {
                    throw new IOException("Invalid SSTable file: " + filePath);
                }

                raf.seek(fileLength - 4 - 32);
                indexOffset = raf.readLong();
                long minTs = raf.readLong();
                long maxTs = raf.readLong();
                long count = raf.readLong();

                raf.seek(indexOffset);
                int indexSize = raf.readInt();
                index = new ArrayList<>(indexSize);
                for (int i = 0; i < indexSize; i++) {
                    String seriesKey = raf.readUTF();
                    long timestamp = raf.readLong();
                    long offset = raf.readLong();
                    int length = raf.readInt();
                    index.add(new SSTableWriter.IndexEntry(seriesKey, timestamp, offset, length));
                }
                indexLoaded = true;
            }
        }
    }

    public List<DataPoint> rangeQuery(String metric, Map<String, String> tagsFilter, long startTime, long endTime) throws IOException {
        loadIndex();
        List<DataPoint> result = new ArrayList<>();

        if (!overlaps(startTime, endTime)) {
            return result;
        }

        try (RandomAccessFile raf = new RandomAccessFile(filePath.toFile(), "r")) {
            for (SSTableWriter.IndexEntry entry : index) {
                if (entry.timestamp < startTime || entry.timestamp > endTime) {
                    continue;
                }

                raf.seek(entry.offset);
                int length = raf.readInt();
                byte[] compressed = new byte[length];
                raf.readFully(compressed);
                long storedChecksum = raf.readLong();

                CRC32 crc = new CRC32();
                crc.update(compressed);
                long calculatedChecksum = crc.getValue();

                if (storedChecksum != calculatedChecksum) {
                    continue;
                }

                byte[] data = Snappy.uncompress(compressed);
                DataPoint dp = deserializeDataPoint(data);

                if (dp.getMetric().equals(metric)
                        && dp.getTags().matches(tagsFilter)) {
                    result.add(dp);
                }
            }
        }

        return result;
    }

    public Iterator<DataPoint> iterator() throws IOException {
        loadIndex();
        return new SSTableIterator();
    }

    private DataPoint deserializeDataPoint(byte[] data) throws IOException {
        try (ByteArrayInputStream bais = new ByteArrayInputStream(data);
             DataInputStream dis = new DataInputStream(bais)) {
            String metric = dis.readUTF();
            int tagsSize = dis.readInt();
            Tags tags = new Tags();
            for (int i = 0; i < tagsSize; i++) {
                String key = dis.readUTF();
                String value = dis.readUTF();
                tags.put(key, value);
            }
            long timestamp = dis.readLong();
            double value = dis.readDouble();
            return new DataPoint(metric, tags, timestamp, value);
        }
    }

    public void delete() throws IOException {
        java.nio.file.Files.deleteIfExists(filePath);
    }

    @Override
    public String toString() {
        return "SSTable{" +
                "filePath=" + filePath +
                ", minTimestamp=" + minTimestamp +
                ", maxTimestamp=" + maxTimestamp +
                ", entryCount=" + entryCount +
                ", fileSize=" + fileSize +
                '}';
    }

    private class SSTableIterator implements Iterator<DataPoint> {
        private int currentIndex = 0;
        private RandomAccessFile raf;

        public SSTableIterator() throws IOException {
            this.raf = new RandomAccessFile(filePath.toFile(), "r");
        }

        @Override
        public boolean hasNext() {
            return currentIndex < index.size();
        }

        @Override
        public DataPoint next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            try {
                SSTableWriter.IndexEntry entry = index.get(currentIndex++);
                raf.seek(entry.offset);
                int length = raf.readInt();
                byte[] compressed = new byte[length];
                raf.readFully(compressed);
                long storedChecksum = raf.readLong();

                CRC32 crc = new CRC32();
                crc.update(compressed);
                if (storedChecksum != crc.getValue()) {
                    return null;
                }

                byte[] data = Snappy.uncompress(compressed);
                return deserializeDataPoint(data);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
    }
}
