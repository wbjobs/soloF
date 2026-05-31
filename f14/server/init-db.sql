CREATE DATABASE IF NOT EXISTS whiteboard;

USE whiteboard;

CREATE TABLE IF NOT EXISTS snapshots (
    id SERIAL PRIMARY KEY,
    board_id VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_board_time ON snapshots(board_id, timestamp DESC);
