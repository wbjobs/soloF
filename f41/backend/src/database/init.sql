CREATE DATABASE soil_monitoring;

\c soil_monitoring;

CREATE TABLE IF NOT EXISTS sensor_nodes (
  id SERIAL PRIMARY KEY,
  dev_eui VARCHAR(16) UNIQUE NOT NULL,
  name VARCHAR(100),
  location VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sensor_data (
  id SERIAL PRIMARY KEY,
  dev_eui VARCHAR(16) NOT NULL,
  humidity DECIMAL(5,2) NOT NULL,
  temperature DECIMAL(5,2) NOT NULL,
  conductivity DECIMAL(10,2) NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dev_eui) REFERENCES sensor_nodes(dev_eui)
);

CREATE INDEX IF NOT EXISTS idx_sensor_data_timestamp ON sensor_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_sensor_data_dev_eui ON sensor_data(dev_eui);

INSERT INTO sensor_nodes (dev_eui, name, location) VALUES
('0000000000000001', '传感器节点1', 'A区农田'),
('0000000000000002', '传感器节点2', 'B区农田'),
('0000000000000003', '传感器节点3', 'C区果园')
ON CONFLICT (dev_eui) DO NOTHING;
