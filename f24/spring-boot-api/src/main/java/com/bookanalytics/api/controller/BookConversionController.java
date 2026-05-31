package com.bookanalytics.api.controller;

import com.bookanalytics.api.model.BookConversion;
import com.bookanalytics.api.service.BookConversionService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/book")
@CrossOrigin(origins = "http://localhost:3000")
public class BookConversionController {

    private final BookConversionService conversionService;

    public BookConversionController(BookConversionService conversionService) {
        this.conversionService = conversionService;
    }

    @GetMapping("/{isbn}/conversion")
    public ResponseEntity<Map<String, Object>> getConversion(@PathVariable String isbn) {
        BookConversion conversion = conversionService.getConversionByIsbn(isbn);
        Map<String, Object> response = new HashMap<>();
        response.put("isbn", conversion.getIsbn());
        response.put("viewCount", conversion.getViewCount());
        response.put("buyCount", conversion.getBuyCount());
        response.put("sellCount", conversion.getSellCount());
        response.put("conversionRate", conversion.getConversionRate());
        response.put("sellBuyRatio", conversion.getSellBuyRatio());
        response.put("lastUpdate", conversion.getLastUpdate());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/top10")
    public ResponseEntity<List<BookConversion>> getTop10() {
        List<BookConversion> top10 = conversionService.getTop10Conversion();
        return ResponseEntity.ok(top10);
    }

    @GetMapping("/all")
    public ResponseEntity<List<BookConversion>> getAll() {
        List<BookConversion> all = conversionService.getAllConversions();
        return ResponseEntity.ok(all);
    }

    @GetMapping("/behavior-summary")
    public ResponseEntity<Map<String, Long>> getBehaviorSummary() {
        Map<String, Long> summary = conversionService.getBehaviorSummary();
        return ResponseEntity.ok(summary);
    }
}
