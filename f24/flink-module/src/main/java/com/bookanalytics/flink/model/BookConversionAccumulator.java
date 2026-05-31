package com.bookanalytics.flink.model;

import java.io.Serializable;

public class BookConversionAccumulator implements Serializable {
    private String isbn;
    private long viewCount;
    private long buyCount;
    private long sellCount;

    public BookConversionAccumulator() {}

    public BookConversionAccumulator(String isbn) {
        this.isbn = isbn;
        this.viewCount = 0;
        this.buyCount = 0;
        this.sellCount = 0;
    }

    public void addView() {
        this.viewCount++;
    }

    public void addBuy() {
        this.buyCount++;
    }

    public void addSell() {
        this.sellCount++;
    }

    public double getConversionRate() {
        if (viewCount == 0) {
            return 0.0;
        }
        return (double) buyCount / viewCount;
    }

    public double getSellBuyRatio() {
        if (buyCount == 0) {
            return 0.0;
        }
        return (double) sellCount / buyCount;
    }

    public String getIsbn() {
        return isbn;
    }

    public void setIsbn(String isbn) {
        this.isbn = isbn;
    }

    public long getViewCount() {
        return viewCount;
    }

    public void setViewCount(long viewCount) {
        this.viewCount = viewCount;
    }

    public long getBuyCount() {
        return buyCount;
    }

    public void setBuyCount(long buyCount) {
        this.buyCount = buyCount;
    }

    public long getSellCount() {
        return sellCount;
    }

    public void setSellCount(long sellCount) {
        this.sellCount = sellCount;
    }
}
