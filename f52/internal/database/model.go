package database

import (
	"time"
)

type DeviceShadowLog struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	DeviceID  string    `gorm:"index:idx_device_id;type:varchar(128);not null" json:"device_id"`
	Version   int64     `gorm:"index:idx_version;not null" json:"version"`
	ChangeType string   `gorm:"type:varchar(32);not null" json:"change_type"`
	Desired   string    `gorm:"type:text" json:"desired,omitempty"`
	Reported  string    `gorm:"type:text" json:"reported,omitempty"`
	Delta     string    `gorm:"type:text" json:"delta,omitempty"`
	CreatedAt time.Time `gorm:"index:idx_created_at;not null" json:"created_at"`
}

func (DeviceShadowLog) TableName() string {
	return "device_shadow_logs"
}

type ChangeType string

const (
	ChangeTypeReported ChangeType = "reported"
	ChangeTypeDesired  ChangeType = "desired"
)
