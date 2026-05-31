package com.tsdb.http;

import com.tsdb.engine.LSMEngine;
import com.tsdb.model.DataPoint;
import com.tsdb.model.Tags;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

public class WriteHandler extends HttpServlet {
    private static final Logger logger = LoggerFactory.getLogger(WriteHandler.class);

    private final LSMEngine engine;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public WriteHandler(LSMEngine engine) {
        this.engine = engine;
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            String contentType = req.getContentType();
            InputStream inputStream = req.getInputStream();

            if ("gzip".equalsIgnoreCase(req.getHeader("Content-Encoding"))) {
                inputStream = new GZIPInputStream(inputStream);
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                baos.write(buffer, 0, read);
            }
            byte[] data = baos.toByteArray();

            List<DataPoint> dataPoints;

            if (contentType != null && contentType.contains("application/x-protobuf")) {
                dataPoints = parsePrometheusRemoteWrite(data);
            } else {
                dataPoints = parseJsonFormat(data);
            }

            if (!dataPoints.isEmpty()) {
                engine.write(dataPoints);
                logger.debug("Wrote {} data points", dataPoints.size());
            }

            resp.setStatus(HttpServletResponse.SC_OK);
            resp.getWriter().write("{\"status\":\"success\",\"count\":" + dataPoints.size() + "}");
        } catch (Exception e) {
            logger.error("Error handling write request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private List<DataPoint> parsePrometheusRemoteWrite(byte[] data) throws IOException {
        List<DataPoint> dataPoints = new ArrayList<>();

        try {
            ByteBuffer buf = ByteBuffer.wrap(data);
            while (buf.hasRemaining()) {
                int tag = readVarint(buf);
                int fieldNumber = tag >> 3;
                int wireType = tag & 0x7;

                if (fieldNumber == 1 && wireType == 2) {
                    int length = readVarint(buf);
                    int oldLimit = buf.limit();
                    buf.limit(buf.position() + length);
                    List<DataPoint> dps = parseTimeSeries(buf);
                    if (dps != null && !dps.isEmpty()) {
                        dataPoints.addAll(dps);
                    }
                    buf.limit(oldLimit);
                } else {
                    skipField(buf, wireType);
                }
            }
        } catch (Exception e) {
            logger.warn("Failed to parse protobuf format, falling back to JSON", e);
            return parseJsonFormat(data);
        }

        return dataPoints;
    }

    private List<DataPoint> parseTimeSeries(ByteBuffer buf) {
        List<DataPoint> result = new ArrayList<>();
        String metric = null;
        Map<String, String> tags = new HashMap<>();
        List<Long> timestamps = new ArrayList<>();
        List<Double> values = new ArrayList<>();

        while (buf.hasRemaining()) {
            int tag = readVarint(buf);
            int fieldNumber = tag >> 3;
            int wireType = tag & 0x7;

            if (fieldNumber == 1 && wireType == 2) {
                int length = readVarint(buf);
                int oldLimit = buf.limit();
                buf.limit(buf.position() + length);
                while (buf.hasRemaining()) {
                    int labelTag = readVarint(buf);
                    int labelField = labelTag >> 3;
                    int labelWire = labelTag & 0x7;

                    if (labelField == 1 && labelWire == 2) {
                        int nameLen = readVarint(buf);
                        byte[] nameBytes = new byte[nameLen];
                        buf.get(nameBytes);
                        String name = new String(nameBytes);

                        int valueTag = readVarint(buf);
                        int valueLen = readVarint(buf);
                        byte[] valueBytes = new byte[valueLen];
                        buf.get(valueBytes);
                        String value = new String(valueBytes);

                        if ("__name__".equals(name)) {
                            metric = value;
                        } else {
                            tags.put(name, value);
                        }
                    } else {
                        skipField(buf, labelWire);
                    }
                }
                buf.limit(oldLimit);
            } else if (fieldNumber == 2 && wireType == 2) {
                int length = readVarint(buf);
                int oldLimit = buf.limit();
                buf.limit(buf.position() + length);
                while (buf.hasRemaining()) {
                    int sampleTag = readVarint(buf);
                    int sampleField = sampleTag >> 3;
                    int sampleWire = sampleTag & 0x7;

                    if (sampleField == 1 && sampleWire == 0) {
                        timestamps.add((long) readVarint(buf));
                    } else if (sampleField == 2 && sampleWire == 1) {
                        values.add(Double.longBitsToDouble(buf.getLong()));
                    } else {
                        skipField(buf, sampleWire);
                    }
                }
                buf.limit(oldLimit);
            } else {
                skipField(buf, wireType);
            }
        }

        if (metric != null && !timestamps.isEmpty() && !values.isEmpty()) {
            Tags tsTags = new Tags(tags);
            for (int i = 0; i < Math.min(timestamps.size(), values.size()); i++) {
                result.add(new DataPoint(metric, tsTags, timestamps.get(i), values.get(i)));
            }
        }

        return result;
    }

    private List<DataPoint> parseJsonFormat(byte[] data) throws IOException {
        List<DataPoint> dataPoints = new ArrayList<>();
        JsonNode root = objectMapper.readTree(data);

        if (root.isArray()) {
            for (JsonNode node : root) {
                DataPoint dp = parseJsonDataPoint(node);
                if (dp != null) {
                    dataPoints.add(dp);
                }
            }
        } else if (root.has("timeseries")) {
            JsonNode timeseries = root.get("timeseries");
            if (timeseries.isArray()) {
                for (JsonNode node : timeseries) {
                    String metric = null;
                    Map<String, String> tags = new HashMap<>();

                    JsonNode labelsNode = node.get("labels");
                    if (labelsNode != null && labelsNode.isArray()) {
                        for (JsonNode label : labelsNode) {
                            String name = label.get("name").asText();
                            String value = label.get("value").asText();
                            if ("__name__".equals(name)) {
                                metric = value;
                            } else {
                                tags.put(name, value);
                            }
                        }
                    }

                    JsonNode samplesNode = node.get("samples");
                    if (samplesNode != null && samplesNode.isArray() && metric != null) {
                        Tags tsTags = new Tags(tags);
                        for (JsonNode sample : samplesNode) {
                            long timestamp = sample.get("timestamp").asLong();
                            double value = sample.get("value").asDouble();
                            dataPoints.add(new DataPoint(metric, tsTags, timestamp, value));
                        }
                    }
                }
            }
        } else {
            DataPoint dp = parseJsonDataPoint(root);
            if (dp != null) {
                dataPoints.add(dp);
            }
        }

        return dataPoints;
    }

    private DataPoint parseJsonDataPoint(JsonNode node) {
        if (node.has("metric") && node.has("timestamp") && node.has("value")) {
            String metric = node.get("metric").asText();
            long timestamp = node.get("timestamp").asLong();
            double value = node.get("value").asDouble();

            Tags tags = new Tags();
            JsonNode tagsNode = node.get("tags");
            if (tagsNode != null && tagsNode.isObject()) {
                tagsNode.fields().forEachRemaining(entry -> tags.put(entry.getKey(), entry.getValue().asText()));
            }

            return new DataPoint(metric, tags, timestamp, value);
        }
        return null;
    }

    private int readVarint(ByteBuffer buf) {
        int result = 0;
        int shift = 0;
        while (true) {
            byte b = buf.get();
            result |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0) break;
            shift += 7;
        }
        return result;
    }

    private void skipField(ByteBuffer buf, int wireType) {
        switch (wireType) {
            case 0:
                readVarint(buf);
                break;
            case 1:
                buf.getLong();
                break;
            case 2:
                int length = readVarint(buf);
                buf.position(buf.position() + length);
                break;
            case 5:
                buf.getInt();
                break;
            default:
                break;
        }
    }
}
