package utils

import "os"

type Config struct {
	MQTTBroker   string
	MQTTClientID string
	RedisAddr    string
	RedisPass    string
	RedisDB      int
	APIPort      string
	PGHost       string
	PGPort       string
	PGUser       string
	PGPassword   string
	PGDBName     string
	PGSSLMode    string
}

func LoadConfig() *Config {
	return &Config{
		MQTTBroker:   getEnv("MQTT_BROKER", "tcp://localhost:1883"),
		MQTTClientID: getEnv("MQTT_CLIENT_ID", "iot-shadow-service"),
		RedisAddr:    getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:    getEnv("REDIS_PASS", ""),
		RedisDB:      0,
		APIPort:      getEnv("API_PORT", ":8080"),
		PGHost:       getEnv("PG_HOST", "localhost"),
		PGPort:       getEnv("PG_PORT", "5432"),
		PGUser:       getEnv("PG_USER", "postgres"),
		PGPassword:   getEnv("PG_PASSWORD", ""),
		PGDBName:     getEnv("PG_DB", "iot_shadow"),
		PGSSLMode:    getEnv("PG_SSLMODE", "disable"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
