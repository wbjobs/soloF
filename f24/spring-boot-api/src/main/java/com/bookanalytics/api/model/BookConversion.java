package com.bookanalytics.api.model;

public class BookConversion {
    private String isbn;
    private long viewCount;
    private long buyCount;
    private long sellCount;
    private double conversionRate;
    private double sellBuyRatio;
    private long lastUpdate;

    public BookConversion() {}

    public BookConversion(String isbn, long viewCount, long buyCount, long sellCount, 
                          double conversionRate, double sellBuyRatio, long lastUpdate) {
        this.isbn = isbn;
        this.viewCount = viewCount;
        this.buyCount = buyCount;
        this.sellCount = sellCount;
        this.conversionRate = conversionRate;
        this.sellBuyRatio = sellBuyRatio;
        this.lastUpdate = lastUpdate;
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

    public double getConversionRate() {
        return conversionRate;
    }

    public void setConversionRate(double conversionRate) {
        this.conversionRate = conversionRate;
    }

    public double getSellBuyRatio() {
        return sellBuyRatio;
    }

    public void setSellBuyRatio(double sellBuyRatio) {
        this.sellBuyRatio = sellBuyRatio;
    }

    public long getLastUpdate() {
        return lastUpdate;
    }

    public void setLastUpdate(long lastUpdate) {
        this.lastUpdate = lastUpdate;
    }
}
