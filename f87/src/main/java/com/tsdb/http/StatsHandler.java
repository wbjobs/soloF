package com.tsdb.http;

import com.tsdb.engine.LSMEngine;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

public class StatsHandler extends HttpServlet {
    private static final Logger logger = LoggerFactory.getLogger(StatsHandler.class);

    private final LSMEngine engine;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public StatsHandler(LSMEngine engine) {
        this.engine = engine;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            LSMEngine.EngineStats stats = engine.getStats();

            ObjectNode response = objectMapper.createObjectNode();
            response.put("status", "success");

            ObjectNode memtableNode = response.putObject("memtable");
            memtableNode.put("active_size_bytes", stats.activeMemTableSize);
            memtableNode.put("active_entries", stats.activeMemTableEntries);
            memtableNode.put("immutable_entries", stats.immutableMemTableEntries);

            ArrayNode levelsArray = response.putArray("levels");
            for (LSMEngine.LevelStats levelStats : stats.levelStats) {
                ObjectNode levelNode = levelsArray.addObject();
                levelNode.put("level", levelStats.level);
                levelNode.put("sstable_count", levelStats.sstableCount);
                levelNode.put("total_size_bytes", levelStats.totalSize);
                levelNode.put("total_entries", levelStats.totalEntries);
            }

            ObjectNode compactionNode = response.putObject("compaction");
            compactionNode.put("count", stats.compactionCount);
            compactionNode.put("bytes_read", stats.compactionBytesRead);
            compactionNode.put("bytes_written", stats.compactionBytesWritten);
            compactionNode.put("write_amplification", String.format("%.2f", stats.writeAmplification));

            ObjectNode statsNode = response.putObject("summary");
            statsNode.put("total_write_points", stats.totalWritePoints);
            statsNode.put("total_flush_bytes", stats.totalFlushBytes);
            statsNode.put("total_sstable_size_bytes", stats.totalSSTableSize);
            statsNode.put("total_sstable_entries", stats.totalSSTableEntries);

            long totalEntries = stats.activeMemTableEntries + stats.immutableMemTableEntries + stats.totalSSTableEntries;
            long totalSize = stats.activeMemTableSize + stats.totalSSTableSize;
            response.put("total_entries", totalEntries);
            response.put("total_size_bytes", totalSize);

            resp.setContentType("application/json");
            resp.setStatus(HttpServletResponse.SC_OK);
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
        } catch (Exception e) {
            logger.error("Error handling stats request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }
}
