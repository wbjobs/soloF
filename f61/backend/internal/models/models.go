package models

import (
	"time"
)

type TaskStatus string

const (
	TaskStatusActive   TaskStatus = "active"
	TaskStatusPaused   TaskStatus = "paused"
	TaskStatusInactive TaskStatus = "inactive"
)

type ExecutionStatus string

const (
	ExecutionStatusRunning ExecutionStatus = "running"
	ExecutionStatusSuccess ExecutionStatus = "success"
	ExecutionStatusFailed  ExecutionStatus = "failed"
)

type Task struct {
	ID             uint64         `gorm:"primaryKey;autoIncrement" json:"id"`
	Name           string         `gorm:"size:255;not null;unique" json:"name"`
	CronExpression string         `gorm:"size:100;not null" json:"cron_expression"`
	Command        string         `gorm:"type:text;not null" json:"command"`
	Status         TaskStatus     `gorm:"size:50;not null;default:active" json:"status"`
	CreatedAt      time.Time      `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt      time.Time      `gorm:"not null;default:CURRENT_TIMESTAMP" json:"updated_at"`
	LastExecution  *TaskExecution `gorm:"-" json:"last_execution,omitempty"`
}

type TaskExecution struct {
	ID        uint64          `gorm:"primaryKey;autoIncrement" json:"id"`
	TaskID    uint64          `gorm:"not null;index" json:"task_id"`
	Status    ExecutionStatus `gorm:"size:50;not null" json:"status"`
	Stdout    string          `gorm:"type:text" json:"stdout,omitempty"`
	Stderr    string          `gorm:"type:text" json:"stderr,omitempty"`
	ExitCode  *int            `json:"exit_code,omitempty"`
	StartedAt time.Time       `gorm:"not null" json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at,omitempty"`
	CreatedAt time.Time       `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
	Task      *Task           `gorm:"foreignKey:TaskID" json:"-"`
}

type CreateTaskRequest struct {
	Name           string `json:"name" binding:"required,max=255"`
	CronExpression string `json:"cron_expression" binding:"required,max=100"`
	Command        string `json:"command" binding:"required"`
}

type UpdateTaskStatusRequest struct {
	Status TaskStatus `json:"status" binding:"required,oneof=active paused inactive"`
}
