package models

import (
	"time"
	"gorm.io/gorm"
)

type Task struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	CronExpr    string    `gorm:"size:100;not null" json:"cron_expr"`
	Command     string    `gorm:"type:text;not null" json:"command"`
	Dependency  string    `gorm:"type:text" json:"dependency"`
	Timeout     int       `gorm:"default:30" json:"timeout"`
	Status      string    `gorm:"size:20;default:'stopped'" json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type TaskLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	TaskID     uint      `gorm:"not null;index" json:"task_id"`
	StartTime  time.Time `gorm:"not null" json:"start_time"`
	EndTime    time.Time `json:"end_time"`
	Status     string    `gorm:"size:20;not null" json:"status"`
	Output     string    `gorm:"type:text" json:"output"`
	CreatedAt  time.Time `json:"created_at"`
}

func Migrate(db *gorm.DB) {
	db.AutoMigrate(&Task{}, &TaskLog{})
}
