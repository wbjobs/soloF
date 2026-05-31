package database

import (
	"context"
	"fmt"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Store struct {
	db *gorm.DB
}

type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

func NewStore(cfg *Config) (*Store, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("postgres connect error: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := db.AutoMigrate(&DeviceShadowLog{}); err != nil {
		return nil, fmt.Errorf("auto migrate error: %w", err)
	}

	return &Store{db: db}, nil
}

func (s *Store) InsertLog(ctx context.Context, log *DeviceShadowLog) error {
	log.CreatedAt = time.Now()
	return s.db.WithContext(ctx).Create(log).Error
}

func (s *Store) GetDeviceHistory(ctx context.Context, deviceID string, since time.Time, limit int) ([]DeviceShadowLog, error) {
	var logs []DeviceShadowLog
	err := s.db.WithContext(ctx).
		Where("device_id = ? AND created_at >= ?", deviceID, since).
		Order("created_at DESC").
		Limit(limit).
		Find(&logs).Error
	return logs, err
}

func (s *Store) GetDeviceHistoryByVersion(ctx context.Context, deviceID string, version int64) (*DeviceShadowLog, error) {
	var log DeviceShadowLog
	err := s.db.WithContext(ctx).
		Where("device_id = ? AND version = ?", deviceID, version).
		Order("created_at DESC").
		First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

func (s *Store) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
