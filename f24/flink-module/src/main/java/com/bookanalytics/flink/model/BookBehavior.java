package com.bookanalytics.flink.model;

public class BookBehavior {
    private String userId;
    private String isbn;
    private String behaviorType;
    private long timestamp;

    public BookBehavior() {}

    public BookBehavior(String userId, String isbn, String behaviorType, long timestamp) {
        this.userId = userId;
        this.isbn = isbn;
        this.behaviorType = behaviorType;
        this.timestamp = timestamp;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getIsbn() {
        return isbn;
    }

    public void setIsbn(String isbn) {
        this.isbn = isbn;
    }

    public String getBehaviorType() {
        return behaviorType;
    }

    public void setBehaviorType(String behaviorType) {
        this.behaviorType = behaviorType;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
}
