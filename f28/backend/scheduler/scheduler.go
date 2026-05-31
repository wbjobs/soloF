package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
	"task-scheduler/config"
	"task-scheduler/models"
	"task-scheduler/utils"
	"task-scheduler/websocket"
	"github.com/robfig/cron/v3"
)

var (
	cronInstance *cron.Cron
	taskEntries  = make(map[int]cron.EntryID)
	taskMutex    sync.Mutex
)

func Init() {
	cronInstance = cron.New(cron.WithSeconds())
	cronInstance.Start()
}

func StartTask(task *models.Task) error {
	if utils.CheckCyclicDependency(task.ID, task.Dependency) {
		return errors.New("存在循环依赖")
	}
	taskMutex.Lock()
	defer taskMutex.Unlock()
	if entryID, exists := taskEntries[int(task.ID)]; exists {
		cronInstance.Remove(entryID)
	}
	entryID, err := cronInstance.AddFunc(task.CronExpr, func() {
		executeTask(task)
	})
	if err != nil {
		return err
	}
	taskEntries[int(task.ID)] = entryID
	return nil
}

func StopTask(taskID int) {
	taskMutex.Lock()
	defer taskMutex.Unlock()
	if entryID, exists := taskEntries[taskID]; exists {
		cronInstance.Remove(entryID)
		delete(taskEntries, taskID)
	}
}

func executeTask(task *models.Task) {
	if utils.CheckCyclicDependency(task.ID, task.Dependency) {
		return
	}
	if !checkDependencies(task) {
		return
	}
	taskLog := models.TaskLog{
		TaskID:    task.ID,
		StartTime: time.Now(),
		Status:    "running",
	}
	config.DB.Create(&taskLog)
	websocket.BroadcastLog(task.ID, taskLog.ID, "任务开始执行...", "running")
	timeout := time.Duration(task.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmdParts := strings.Fields(task.Command)
	var cmd *exec.Cmd
	if len(cmdParts) > 1 {
		cmd = exec.CommandContext(ctx, cmdParts[0], cmdParts[1:]...)
	} else {
		cmd = exec.CommandContext(ctx, cmdParts[0])
	}
	var outputBuffer bytes.Buffer
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		outputBuffer.WriteString("创建stdout管道失败: " + err.Error() + "\n")
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		outputBuffer.WriteString("创建stderr管道失败: " + err.Error() + "\n")
	}
	if err := cmd.Start(); err != nil {
		taskLog.EndTime = time.Now()
		taskLog.Output = "启动命令失败: " + err.Error()
		taskLog.Status = "failed"
		config.DB.Save(&taskLog)
		websocket.BroadcastLog(task.ID, taskLog.ID, taskLog.Output, "failed")
		return
	}
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				outputBuffer.Write(buf[:n])
				websocket.BroadcastLog(task.ID, taskLog.ID, string(buf[:n]), "running")
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				outputBuffer.Write(buf[:n])
				websocket.BroadcastLog(task.ID, taskLog.ID, string(buf[:n]), "running")
			}
			if err != nil {
				break
			}
		}
	}()
	err = cmd.Wait()
	taskLog.EndTime = time.Now()
	taskLog.Output = outputBuffer.String()
	if ctx.Err() == context.DeadlineExceeded {
		taskLog.Status = "timeout"
		taskLog.Output += "\n任务执行超时，已强制终止"
		websocket.BroadcastLog(task.ID, taskLog.ID, "\n任务执行超时，已强制终止", "timeout")
	} else if err != nil {
		taskLog.Status = "failed"
		websocket.BroadcastLog(task.ID, taskLog.ID, "\n任务执行失败", "failed")
	} else {
		taskLog.Status = "success"
		websocket.BroadcastLog(task.ID, taskLog.ID, "\n任务执行成功", "success")
	}
	config.DB.Save(&taskLog)
}

func checkDependencies(task *models.Task) bool {
	if task.Dependency == "" {
		return true
	}
	var dependencyIDs []int
	if err := json.Unmarshal([]byte(task.Dependency), &dependencyIDs); err != nil {
		return false
	}
	for _, depID := range dependencyIDs {
		var lastLog models.TaskLog
		config.DB.Where("task_id = ?", depID).Order("start_time desc").First(&lastLog)
		if lastLog.ID == 0 || lastLog.Status != "success" {
			return false
		}
	}
	return true
}

func GetNextRunTime(taskID int) (time.Time, bool) {
	taskMutex.Lock()
	defer taskMutex.Unlock()
	if entryID, exists := taskEntries[taskID]; exists {
		entry := cronInstance.Entry(entryID)
		loc, _ := time.LoadLocation("Local")
		return entry.Next.In(loc), true
	}
	return time.Time{}, false
}
