package com.backend.controller;

import com.backend.service.MLModelService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ml")
@CrossOrigin(origins = "*")
public class MLModelController {

    private final MLModelService mlModelService;

    public MLModelController(MLModelService mlModelService) {
        this.mlModelService = mlModelService;
    }

    @GetMapping("/model/info")
    public ResponseEntity<Map<String, Object>> getModelInfo() {
        try {
            Map<String, Object> modelInfo = mlModelService.getModelInfo();
            return ResponseEntity.ok(modelInfo);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @PostMapping("/samples/label")
    public ResponseEntity<Map<String, Object>> labelSample(@RequestBody LabelSampleRequest request) {
        try {
            MLModelService.ExtractedFeatures features =
                    mlModelService.extractFeatures(request.getTransactionData());

            mlModelService.addLabeledSample(
                    request.getTransactionId(),
                    request.getUserId(),
                    features.getFeatures(),
                    request.isAnomaly(),
                    request.getAnnotator(),
                    request.getNotes()
            );

            Map<String, Object> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "Sample labeled successfully");
            response.put("featuresExtracted", features.getFeatures().length);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("status", "error");
            error.put("message", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @GetMapping("/samples/recent")
    public ResponseEntity<List<Map<String, Object>>> getRecentLabeledSamples(
            @RequestParam(defaultValue = "20") int count) {
        try {
            List<Map<String, Object>> samples = mlModelService.getRecentLabeledSamples(count);
            return ResponseEntity.ok(samples);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/model/retrain")
    public ResponseEntity<Map<String, Object>> triggerRetrain() {
        try {
            mlModelService.triggerModelRetrain();
            Map<String, Object> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "Model retraining triggered");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("status", "error");
            error.put("message", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @GetMapping("/model/threshold")
    public ResponseEntity<Map<String, Object>> getThreshold() {
        try {
            double threshold = mlModelService.getModelThreshold();
            Map<String, Object> response = new HashMap<>();
            response.put("threshold", threshold);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @PostMapping("/model/threshold")
    public ResponseEntity<Map<String, Object>> setThreshold(@RequestBody Map<String, Double> request) {
        try {
            double threshold = request.get("threshold");
            if (threshold < 0 || threshold > 1) {
                Map<String, Object> error = new HashMap<>();
                error.put("status", "error");
                error.put("message", "Threshold must be between 0 and 1");
                return ResponseEntity.badRequest().body(error);
            }
            mlModelService.setModelThreshold(threshold);
            Map<String, Object> response = new HashMap<>();
            response.put("status", "success");
            response.put("message", "Threshold updated to " + threshold);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("status", "error");
            error.put("message", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getMLStats() {
        try {
            Map<String, Object> stats = new HashMap<>();
            stats.put("modelVersion", mlModelService.getModelVersion());
            stats.put("labeledSampleCount", mlModelService.getLabeledSampleCount());
            stats.put("modelInfo", mlModelService.getModelInfo());
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.internalServerError().body(error);
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class LabelSampleRequest {
        @JsonProperty("transactionId")
        private String transactionId;

        @JsonProperty("userId")
        private String userId;

        @JsonProperty("isAnomaly")
        private boolean isAnomaly;

        @JsonProperty("annotator")
        private String annotator;

        @JsonProperty("notes")
        private String notes;

        @JsonProperty("transactionData")
        private Map<String, Object> transactionData;
    }
}
