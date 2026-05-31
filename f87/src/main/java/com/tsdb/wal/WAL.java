package com.tsdb.wal;

import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.CRC32;

public class WAL implements Closeable {
    private final Path walDir;
    private final Path currentWalFile;
    private DataOutputStream outputStream;
    private final Object lock = new Object();
    private long fileId;

    public WAL(String walDirPath) throws IOException {
        this.walDir = Paths.get(walDirPath);
        Files.createDirectories(this.walDir);
        this.fileId = System.currentTimeMillis();
        this.currentWalFile = this.walDir.resolve("wal_" + fileId + ".log");
        this.outputStream = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(currentWalFile.toFile(), true)));
    }

    public void append(DataPoint dataPoint) throws IOException {
        synchronized (lock) {
            byte[] data = serialize(dataPoint);
            CRC32 crc = new CRC32();
            crc.update(data);
            long checksum = crc.getValue();

            outputStream.writeInt(data.length);
            outputStream.write(data);
            outputStream.writeLong(checksum);
            outputStream.flush();
        }
    }

    public List<DataPoint> recover() throws IOException {
        List<DataPoint> recovered = new ArrayList<>();
        List<Path> walFiles = listWalFiles();

        for (Path walFile : walFiles) {
            try (DataInputStream inputStream = new DataInputStream(new BufferedInputStream(new FileInputStream(walFile.toFile())))) {
                while (true) {
                    try {
                        int length = inputStream.readInt();
                        byte[] data = new byte[length];
                        inputStream.readFully(data);
                        long storedChecksum = inputStream.readLong();

                        CRC32 crc = new CRC32();
                        crc.update(data);
                        long calculatedChecksum = crc.getValue();

                        if (storedChecksum == calculatedChecksum) {
                            recovered.add(deserialize(data));
                        }
                    } catch (EOFException e) {
                        break;
                    }
                }
            }
        }

        return recovered;
    }

    public void deleteOldFiles(long keepFileId) throws IOException {
        List<Path> walFiles = listWalFiles();
        for (Path walFile : walFiles) {
            String fileName = walFile.getFileName().toString();
            long id = Long.parseLong(fileName.replace("wal_", "").replace(".log", ""));
            if (id < keepFileId) {
                Files.deleteIfExists(walFile);
            }
        }
    }

    private List<Path> listWalFiles() throws IOException {
        List<Path> walFiles = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(walDir, "wal_*.log")) {
            for (Path entry : stream) {
                walFiles.add(entry);
            }
        }
        walFiles.sort(Comparator.comparing(p -> p.getFileName().toString()));
        return walFiles;
    }

    private byte[] serialize(DataPoint dataPoint) throws IOException {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ObjectOutputStream oos = new ObjectOutputStream(baos)) {
            oos.writeUTF(dataPoint.getMetric());
            oos.writeInt(dataPoint.getTags().getTags().size());
            for (Map.Entry<String, String> entry : dataPoint.getTags().entrySet()) {
                oos.writeUTF(entry.getKey());
                oos.writeUTF(entry.getValue());
            }
            oos.writeLong(dataPoint.getTimestamp());
            oos.writeDouble(dataPoint.getValue());
            oos.flush();
            return baos.toByteArray();
        }
    }

    private DataPoint deserialize(byte[] data) throws IOException {
        try (ByteArrayInputStream bais = new ByteArrayInputStream(data);
             ObjectInputStream ois = new ObjectInputStream(bais)) {
            String metric = ois.readUTF();
            int tagsSize = ois.readInt();
            Tags tags = new Tags();
            for (int i = 0; i < tagsSize; i++) {
                String key = ois.readUTF();
                String value = ois.readUTF();
                tags.put(key, value);
            }
            long timestamp = ois.readLong();
            double value = ois.readDouble();
            return new DataPoint(metric, tags, timestamp, value);
        }
    }

    public long getCurrentFileId() {
        return fileId;
    }

    @Override
    public void close() throws IOException {
        synchronized (lock) {
            if (outputStream != null) {
                outputStream.flush();
                outputStream.close();
                outputStream = null;
            }
        }
    }
}
