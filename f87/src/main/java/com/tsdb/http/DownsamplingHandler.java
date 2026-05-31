package com.tsdb.http;

import com.tsdb.downsampling.DownsamplingEngine;
import com.tsdb.downsampling.DownsamplingRule;
import com.fasterxml.jackson.databind.JsonNode;
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
import java.util.List;
import java.util.concurrent.TimeUnit;

public class DownsamplingHandler extends HttpServlet {
    private static final Logger logger = LoggerFactory.getLogger(DownsamplingHandler.class);

    private final DownsamplingEngine downsamplingEngine;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public DownsamplingHandler(DownsamplingEngine downsamplingEngine) {
        this.downsamplingEngine = downsamplingEngine;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            String pathInfo = req.getPathInfo();

            if (pathInfo == null || pathInfo.equals("/") || pathInfo.isEmpty()) {
                handleGetRulesAndStats(resp);
            } else if (pathInfo.equals("/stats")) {
                handleGetStats(resp);
            } else if (pathInfo.startsWith("/rules/")) {
                int index = Integer.parseInt(pathInfo.substring(7));
                handleGetRule(index, resp);
            } else {
                resp.setStatus(HttpServletResponse.SC_NOT_FOUND);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Unknown endpoint\"}");
            }
        } catch (Exception e) {
            logger.error("Error handling GET request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            String pathInfo = req.getPathInfo();

            if (pathInfo == null || pathInfo.equals("/") || pathInfo.isEmpty()) {
                handleAddRule(req, resp);
            } else if (pathInfo.equals("/run")) {
                handleRunDownsampling(resp);
            } else {
                resp.setStatus(HttpServletResponse.SC_NOT_FOUND);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Unknown endpoint\"}");
            }
        } catch (Exception e) {
            logger.error("Error handling POST request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    @Override
    protected void doPut(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            String pathInfo = req.getPathInfo();
            if (pathInfo != null && pathInfo.startsWith("/")) {
                int index = Integer.parseInt(pathInfo.substring(1));
                handleUpdateRule(index, req, resp);
            } else {
                resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Rule index required\"}");
            }
        } catch (NumberFormatException e) {
            resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Invalid rule index\"}");
        } catch (Exception e) {
            logger.error("Error handling PUT request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    @Override
    protected void doDelete(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            String pathInfo = req.getPathInfo();
            if (pathInfo != null && pathInfo.startsWith("/")) {
                int index = Integer.parseInt(pathInfo.substring(1));
                handleDeleteRule(index, resp);
            } else {
                resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                resp.getWriter().write("{\"status\":\"error\",\"message\":\"Rule index required\"}");
            }
        } catch (NumberFormatException e) {
            resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Invalid rule index\"}");
        } catch (Exception e) {
            logger.error("Error handling DELETE request", e);
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"" + e.getMessage() + "\"}");
        }
    }

    private void handleGetRulesAndStats(HttpServletResponse resp) throws IOException {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");

        addStatsToResponse(response);
        addRulesToResponse(response);

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_OK);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void handleGetStats(HttpServletResponse resp) throws IOException {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");
        addStatsToResponse(response);

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_OK);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void handleGetRule(int index, HttpServletResponse resp) throws IOException {
        List<DownsamplingRule> rules = downsamplingEngine.getRules();
        if (index < 0 || index >= rules.size()) {
            resp.setStatus(HttpServletResponse.SC_NOT_FOUND);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Rule not found\"}");
            return;
        }

        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");
        response.set("rule", ruleToJson(rules.get(index), index));

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_OK);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void handleAddRule(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        JsonNode body = objectMapper.readTree(req.getInputStream());
        DownsamplingRule rule = parseRuleFromJson(body);

        downsamplingEngine.addRule(rule);

        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");
        response.put("message", "Rule added successfully");
        response.set("rule", ruleToJson(rule, downsamplingEngine.getRules().size() - 1));

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_CREATED);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void handleUpdateRule(int index, HttpServletRequest req, HttpServletResponse resp) throws IOException {
        List<DownsamplingRule> rules = downsamplingEngine.getRules();
        if (index < 0 || index >= rules.size()) {
            resp.setStatus(HttpServletResponse.SC_NOT_FOUND);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Rule not found\"}");
            return;
        }

        JsonNode body = objectMapper.readTree(req.getInputStream());
        DownsamplingRule rule = parseRuleFromJson(body);

        downsamplingEngine.updateRule(index, rule);

        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");
        response.put("message", "Rule updated successfully");
        response.set("rule", ruleToJson(rule, index));

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_OK);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void handleDeleteRule(int index, HttpServletResponse resp) throws IOException {
        List<DownsamplingRule> rules = downsamplingEngine.getRules();
        if (index < 0 || index >= rules.size()) {
            resp.setStatus(HttpServletResponse.SC_NOT_FOUND);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Rule not found\"}");
            return;
        }

        DownsamplingRule rule = rules.get(index);
        boolean removed = downsamplingEngine.removeRule(rule);

        if (removed) {
            ObjectNode response = objectMapper.createObjectNode();
            response.put("status", "success");
            response.put("message", "Rule deleted successfully");

            resp.setContentType("application/json");
            resp.setStatus(HttpServletResponse.SC_OK);
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
        } else {
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"status\":\"error\",\"message\":\"Failed to delete rule\"}");
        }
    }

    private void handleRunDownsampling(HttpServletResponse resp) throws IOException {
        logger.info("Manual downsampling triggered via API");

        ObjectNode response = objectMapper.createObjectNode();
        response.put("status", "success");
        response.put("message", "Downsampling started");

        new Thread(() -> {
            try {
                downsamplingEngine.performDownsampling();
                logger.info("Manual downsampling completed");
            } catch (IOException e) {
                logger.error("Manual downsampling failed", e);
            }
        }).start();

        resp.setContentType("application/json");
        resp.setStatus(HttpServletResponse.SC_ACCEPTED);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(resp.getWriter(), response);
    }

    private void addStatsToResponse(ObjectNode response) {
        DownsamplingEngine.DownsamplingStats stats = downsamplingEngine.getStats();

        ObjectNode statsNode = response.putObject("stats");
        statsNode.put("total_downsampled_points", stats.totalDownsampledPoints);
        statsNode.put("total_aggregated_points", stats.totalAggregatedPoints);
        statsNode.put("downsampling_count", stats.downsamplingCount);
        statsNode.put("rules_count", stats.rulesCount);
        statsNode.put("enabled_rules_count", stats.enabledRulesCount);

        if (stats.lastRunTime > 0) {
            statsNode.put("last_run_time", stats.lastRunTime);
        }
    }

    private void addRulesToResponse(ObjectNode response) {
        ArrayNode rulesArray = response.putArray("rules");
        List<DownsamplingRule> rules = downsamplingEngine.getRules();
        for (int i = 0; i < rules.size(); i++) {
            rulesArray.add(ruleToJson(rules.get(i), i));
        }
    }

    private ObjectNode ruleToJson(DownsamplingRule rule, int index) {
        ObjectNode ruleNode = objectMapper.createObjectNode();
        ruleNode.put("id", index);
        ruleNode.put("metric_pattern", rule.getMetricPattern());
        ruleNode.put("retention_threshold_ms", rule.getRetentionThreshold());
        ruleNode.put("retention_days", TimeUnit.MILLISECONDS.toDays(rule.getRetentionThreshold()));
        ruleNode.put("aggregation_interval_ms", rule.getAggregationInterval());
        ruleNode.put("aggregation_interval_hours", TimeUnit.MILLISECONDS.toHours(rule.getAggregationInterval()));
        ruleNode.put("aggregation_function", rule.getAggregationFunction().name());
        ruleNode.put("enabled", rule.isEnabled());
        ruleNode.put("delete_original_data", rule.isDeleteOriginalData());
        return ruleNode;
    }

    private DownsamplingRule parseRuleFromJson(JsonNode json) {
        String metricPattern = json.has("metric_pattern") ? json.get("metric_pattern").asText() : ".*";

        long retentionMs;
        if (json.has("retention_days")) {
            retentionMs = TimeUnit.DAYS.toMillis(json.get("retention_days").asLong());
        } else if (json.has("retention_threshold_ms")) {
            retentionMs = json.get("retention_threshold_ms").asLong();
        } else {
            retentionMs = TimeUnit.DAYS.toMillis(7);
        }

        long intervalMs;
        if (json.has("aggregation_interval_hours")) {
            intervalMs = TimeUnit.HOURS.toMillis(json.get("aggregation_interval_hours").asLong());
        } else if (json.has("aggregation_interval_ms")) {
            intervalMs = json.get("aggregation_interval_ms").asLong();
        } else {
            intervalMs = TimeUnit.HOURS.toMillis(1);
        }

        String functionStr = json.has("aggregation_function") ? json.get("aggregation_function").asText() : "AVG";
        DownsamplingRule.AggregationFunction function;
        try {
            function = DownsamplingRule.AggregationFunction.valueOf(functionStr.toUpperCase());
        } catch (IllegalArgumentException e) {
            function = DownsamplingRule.AggregationFunction.AVG;
        }

        boolean enabled = json.has("enabled") ? json.get("enabled").asBoolean() : true;
        boolean deleteOriginal = json.has("delete_original_data") ? json.get("delete_original_data").asBoolean() : true;

        DownsamplingRule rule = new DownsamplingRule(metricPattern, retentionMs, intervalMs, function);
        rule.setEnabled(enabled);
        rule.setDeleteOriginalData(deleteOriginal);

        return rule;
    }
}
