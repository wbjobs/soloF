package scheduler

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sync"
	"task-scheduler/internal/database"
	"task-scheduler/internal/models"
	"time"

	"github.com/go-co-op/gocron/v2"
)

type TaskScheduler struct {
	scheduler gocron.Scheduler
	jobs      map[uint64]gocron.Job
	mu        sync.RWMutex
}

var instance *TaskScheduler
var once sync.Once

func GetInstance() *TaskScheduler {
	once.Do(func() {
		s, err := gocron.NewScheduler()
		if err != nil {
			panic(fmt.Sprintf("failed to create scheduler: %v", err))
		}
		instance = &TaskScheduler{
			scheduler: s,
			jobs:      make(map[uint64]gocron.Job),
		}
	})
	return instance
}

func (ts *TaskScheduler) Start() {
	ts.scheduler.Start()
}

func (ts *TaskScheduler) Shutdown() {
	_ = ts.scheduler.Shutdown()
}

func (ts *TaskScheduler) AddTask(task *models.Task) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if task.Status != models.TaskStatusActive {
		return nil
	}

	job, err := ts.scheduler.NewJob(
		gocron.CronJob(task.CronExpression, false),
		gocron.NewTask(ts.executeTask, task.ID),
		gocron.WithName(task.Name),
	)
	if err != nil {
		return fmt.Errorf("failed to create job: %w", err)
	}

	ts.jobs[task.ID] = job
	return nil
}

func (ts *TaskScheduler) RemoveTask(taskID uint64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if job, exists := ts.jobs[taskID]; exists {
		_ = ts.scheduler.RemoveJob(job.ID())
		delete(ts.jobs, taskID)
	}
}

func (ts *TaskScheduler) UpdateTask(task *models.Task) {
	ts.RemoveTask(task.ID)
	_ = ts.AddTask(task)
}

func (ts *TaskScheduler) TriggerTask(taskID uint64) error {
	db := database.GetDB()
	var task models.Task
	if err := db.First(&task, taskID).Error; err != nil {
		return fmt.Errorf("task not found: %w", err)
	}

	go ts.executeTask(taskID)
	return nil
}

func (ts *TaskScheduler) executeTask(taskID uint64) {
	db := database.GetDB()

	var task models.Task
	if err := db.First(&task, taskID).Error; err != nil {
		fmt.Printf("task %d not found: %v\n", taskID, err)
		return
	}

	execution := &models.TaskExecution{
		TaskID:    taskID,
		Status:    models.ExecutionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := db.Create(execution).Error; err != nil {
		fmt.Printf("failed to create execution record: %v\n", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "cmd", "/C", task.Command)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	finishedAt := time.Now()

	execution.FinishedAt = &finishedAt
	execution.Stdout = stdout.String()
	execution.Stderr = stderr.String()

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode := exitErr.ExitCode()
			execution.ExitCode = &exitCode
		} else {
			code := -1
			execution.ExitCode = &code
		}
		execution.Status = models.ExecutionStatusFailed
	} else {
		code := 0
		execution.ExitCode = &code
		execution.Status = models.ExecutionStatusSuccess
	}

	if err := db.Save(execution).Error; err != nil {
		fmt.Printf("failed to update execution record: %v\n", err)
	}
}

func (ts *TaskScheduler) LoadTasksFromDB() error {
	db := database.GetDB()
	var tasks []models.Task
	if err := db.Where("status = ?", models.TaskStatusActive).Find(&tasks).Error; err != nil {
		return fmt.Errorf("failed to load tasks: %w", err)
	}

	for i := range tasks {
		if err := ts.AddTask(&tasks[i]); err != nil {
			fmt.Printf("failed to add task %s: %v\n", tasks[i].Name, err)
		}
	}

	return nil
}
