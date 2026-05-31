export const TaskStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  INACTIVE: 'inactive',
}

export const ExecutionStatus = {
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
}

export const taskStatusMap = {
  [TaskStatus.ACTIVE]: { text: '运行中', color: 'success' },
  [TaskStatus.PAUSED]: { text: '已暂停', color: 'warning' },
  [TaskStatus.INACTIVE]: { text: '已停用', color: 'default' },
}

export const executionStatusMap = {
  [ExecutionStatus.RUNNING]: { text: '执行中', color: 'processing' },
  [ExecutionStatus.SUCCESS]: { text: '成功', color: 'success' },
  [ExecutionStatus.FAILED]: { text: '失败', color: 'error' },
}
