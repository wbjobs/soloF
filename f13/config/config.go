package config

import "os"

type Config struct {
	InfluxDB InfluxDBConfig
	Server   ServerConfig
}

type InfluxDBConfig struct {
	URL    string
	Token  string
	Org    string
	Bucket string
}

type ServerConfig struct {
	Port string
}

func LoadConfig() *Config {
	return &Config{
		InfluxDB: InfluxDBConfig{
			URL:    getEnv("INFLUXDB_URL", "http://localhost:8086"),
			Token:  getEnv("INFLUXDB_TOKEN", "my-super-secret-auth-token"),
			Org:    getEnv("INFLUXDB_ORG", "anomaly-org"),
			Bucket: getEnv("INFLUXDB_BUCKET", "sensor-data"),
		},
		Server: ServerConfig{
			Port: getEnv("SERVER_PORT", "8080"),
		},
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
