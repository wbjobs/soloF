package utils

import (
	"encoding/json"
	"task-scheduler/config"
	"task-scheduler/models"
)

func CheckCyclicDependency(taskID uint, dependencyStr string) bool {
	if dependencyStr == "" {
		return false
	}
	var dependencyIDs []int
	if err := json.Unmarshal([]byte(dependencyStr), &dependencyIDs); err != nil {
		return false
	}
	visited := make(map[int]bool)
	return dfsCheck(int(taskID), dependencyIDs, visited)
}

func dfsCheck(targetID int, dependencyIDs []int, visited map[int]bool) bool {
	for _, depID := range dependencyIDs {
		if depID == targetID {
			return true
		}
		if visited[depID] {
			continue
		}
		visited[depID] = true
		var depTask models.Task
		if err := config.DB.Where("id = ?", depID).First(&depTask).Error; err != nil {
			continue
		}
		if depTask.Dependency != "" {
			var subDeps []int
			if err := json.Unmarshal([]byte(depTask.Dependency), &subDeps); err == nil {
				if dfsCheck(targetID, subDeps, visited) {
					return true
				}
			}
		}
	}
	return false
}

func CheckTaskIsDepended(taskID uint) (bool, string) {
	var tasks []models.Task
	config.DB.Find(&tasks)
	for _, task := range tasks {
		if task.ID == taskID || task.Dependency == "" {
			continue
		}
		var dependencyIDs []int
		if err := json.Unmarshal([]byte(task.Dependency), &dependencyIDs); err != nil {
			continue
		}
		for _, depID := range dependencyIDs {
			if depID == int(taskID) {
				return true, task.Name
			}
		}
	}
	return false, ""
}
