package com.tsdb.sstable;

import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;
import org.xerial.snappy.Snappy;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.util.*;
import java.util.zip.CRC32;

public class SSTableWriter implements Closeable {
    private final Path filePath;
    private final DataOutputStream dataStream;
    private final List<IndexEntry> index;
    private long minTimestamp = Long.MAX_VALUE;
    private long maxTimestamp = Long.MIN_VALUE;
    private long currentOffset;
    private long entryCount;
    private long fileSize;

    public SSTableWriter(String dataDir, long level, long generation) throws IOException {
        Files.createDirectories(Paths.get(dataDir));
        this.filePath = Paths.get(dataDir, String.format("sst_%d_%d.sst", level, generation));
        this.dataStream = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(filePath.toFile())));
        this.index = new ArrayList<>();
        this.entryCount = 0;
        writeHeader();
    }

    private void writeHeader() throws IOException {
        byte[] magic = "TSDB".getBytes();
        dataStream.write(magic);
        dataStream.writeInt(1);
        currentOffset = 4 + 4;
    }

    public void write(DataPoint dataPoint) throws IOException {
        byte[] serialized = serializeDataPoint(dataPoint);
        byte[] compressed = Snappy.compress(serialized);

        CRC32 crc = new CRC32();
        crc.update(compressed);
        long checksum = crc.getValue();

        long offset = currentOffset;
        index.add(new IndexEntry(dataPoint.getSeriesKey(), dataPoint.getTimestamp(), offset, compressed.length));

        dataStream.writeInt(compressed.length);
        dataStream.write(compressed);
        dataStream.writeLong(checksum);
        currentOffset += 4 + compressed.length + 8;

        if (dataPoint.getTimestamp() < minTimestamp) {
            minTimestamp = dataPoint.getTimestamp();
        }
        if (dataPoint.getTimestamp() > maxTimestamp) {
            maxTimestamp = dataPoint.getTimestamp();
        }

        entryCount++;
    }

    public SSTable finish() throws IOException {
        long indexOffset = dataStream.size();

        dataStream.writeInt(index.size());
        for (IndexEntry entry : index) {
            dataStream.writeUTF(entry.seriesKey);
            dataStream.writeLong(entry.timestamp);
            dataStream.writeLong(entry.offset);
            dataStream.writeInt(entry.length);
        }

        dataStream.writeLong(indexOffset);
        dataStream.writeLong(minTimestamp);
        dataStream.writeLong(maxTimestamp);
        dataStream.writeLong(entryCount);

        byte[] magic = "TSDB".getBytes();
        dataStream.write(magic);

        fileSize = dataStream.size();
        dataStream.flush();

        return new SSTable(filePath, minTimestamp, maxTimestamp, entryCount, fileSize);
    }

    private byte[] serializeDataPoint(DataPoint dp) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        DataOutputStream dos = new DataOutputStream(baos);

        dos.writeUTF(dp.getMetric());

        Map<String, String> tagsMap = dp.getTags().getTags();
        dos.writeInt(tagsMap.size());
        for (Map.Entry<String, String> entry : tagsMap.entrySet()) {
            dos.writeUTF(entry.getKey());
            dos.writeUTF(entry.getValue());
        }

        dos.writeLong(dp.getTimestamp());
        dos.writeDouble(dp.getValue());
        dos.flush();

        return baos.toByteArray();
    }

    @Override
    public void close() throws IOException {
        dataStream.close();
    }

    public static class IndexEntry {
        public final String seriesKey;
        public final long timestamp;
        public final long offset;
        public final int length;

        public IndexEntry(String seriesKey, long timestamp, long offset, int length) {
            this.seriesKey = seriesKey;
            this.timestamp = timestamp;
            this.offset = offset;
            this.length = length;
        }
    }
}
