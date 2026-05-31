package com.tsdb.http;

import com.tsdb.engine.LSMEngine;
import com.tsdb.model.DataPoint;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class QueryHandler extends HttpServlet {
    private static final Logger logger = LoggerFactory.getLogger(QueryHandler.class);

    private final LSMEngine engine;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public QueryHandler(LSMEngine engine) {
        this.engine = engine;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        processQuery(req, resp);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        processQuery(req, resp);
    }

    private void processQuery(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        try {
            String metric = req.getParameter("metric");
            String startStr = req.getParameter("start");
            String endStr = req.getParameter("end");

            if (metric == null || metric.isEmpty()) {
                resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Missing required parameter: metric\"}");
                return;
            }

            long startTime;
            long endTime;

            try {
                if (startStr != null && !startStr.isEmpty()) {
                    startTime = Long.parseLong(startStr);
                } else {
                    startTime = 0;
                }

                if (endStr != null && !endStr.isEmpty()) {
                    endTime = Long.parseLong(endStr);
                } else {
                    endTime = System.currentTimeMillis();
                }
            } catch (NumberFormatException e) {
                resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Invalid timestamp format\"}");
                return;
            }

            Map<String, String> tagsFilter = parseTagsFilter(req);

            List<DataPoint> results = engine.rangeQuery(metric, tagsFilter, startTime, endTime);

            ObjectNode response = objectMapper.createObjectNode();
            response.put("status", "success");
            response.put("metric", metric);
            response.put("count", results.size());

            ArrayNode dataArray = response.putArray("data");
            for (DataPoint dp : results) {
                ObjectNode pointNode = dataArray.addObject();
                pointNode.put("timestamp", dp.getTimestamp());
                pointNode.put("value", dp.getValue());
                ObjectNode tagsNode = pointNode.putObject("tags");
                for (Map.Entry<String, String> tag : dp.getTags().getTags().entrySet()) {
                    tagsNode.put(tag.getKey(), tag.getValue());
                }
            }

            resp.setContentType("application/json");
            resp.setStatus(HttpServletResponse.SC_OK);
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);

            logger.debug("Query returned {} results for metric {}", results.size(), metric);
        } catch (Exception e) {
            logger.error("Error handling query request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private Map<String, String> parseTagsFilter(HttpServletRequest req) {
        Map<String, String> tagsFilter = new HashMap<>();

        String tagsParam = req.getParameter("tags");
        if (tagsParam != null && !tagsParam.isEmpty()) {
            String[] tagPairs = tagsParam.split(",");
            for (String pair : tagPairs) {
                String[] parts = pair.split("=");
                if (parts.length == 2) {
                    tagsFilter.put(parts[0].trim(), parts[1].trim());
                }
            }
        }

        for (String paramName : req.getParameterMap().keySet()) {
            if (paramName.startsWith("tag_")) {
                String tagName = paramName.substring(4);
                String tagValue = req.getParameter(paramName);
                if (tagValue != null && !tagValue.isEmpty()) {
                    tagsFilter.put(tagName, tagValue);
                }
            }
        }

        return tagsFilter;
    }
}
