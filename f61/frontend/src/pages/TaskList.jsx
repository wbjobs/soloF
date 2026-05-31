import React, { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Tag,
  Space,
  Modal,
  message,
  Popconfirm,
  Card,
  Descriptions,
  Tabs,
  Typography,
} from 'antd'
import { PlusOutlined, EyeOutlined, DeleteOutlined, PlayCircleOutlined, PauseCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { taskAPI } from '../services/api.js'
import { TaskStatus, taskStatusMap, executionStatusMap } from '../types/index.js'

const { Text } = Typography

const TaskList = () => {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [detailVisible, setDetailVisible] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [executions, setExecutions] = useState([])
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const navigate = useNavigate()

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const response = await taskAPI.getTasks()
      setTasks(response.data)
    } catch (error) {
      message.error('获取任务列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    const interval = setInterval(fetchTasks, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleViewDetail = async (task) => {
    setSelectedTask(task)
    setDetailVisible(true)
    fetchExecutions(task.id)
  }

  const fetchExecutions = async (taskId) => {
    setExecutionsLoading(true)
    try {
      const response = await taskAPI.getTaskExecutions(taskId, 20)
      setExecutions(response.data)
    } catch (error) {
      message.error('获取执行日志失败')
    } finally {
      setExecutionsLoading(false)
    }
  }

  const handleUpdateStatus = async (task, newStatus) => {
    try {
      await taskAPI.updateTaskStatus(task.id, newStatus)
      message.success('任务状态更新成功')
      fetchTasks()
    } catch (error) {
      message.error('任务状态更新失败')
    }
  }

  const handleDelete = async (taskId) => {
    try {
      await taskAPI.deleteTask(taskId)
      message.success('任务删除成功')
      fetchTasks()
    } catch (error) {
      message.error('任务删除失败')
    }
  }

  const handleTrigger = async (taskId) => {
    try {
      await taskAPI.triggerTask(taskId)
      message.success('任务已触发执行')
      setTimeout(() => {
        fetchTasks()
      }, 1000)
    } catch (error) {
      message.error('任务触发失败')
    }
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: 'Cron 表达式',
      dataIndex: 'cron_expression',
      key: 'cron_expression',
      width: 150,
    },
    {
      title: '命令',
      dataIndex: 'command',
      key: 'command',
      ellipsis: true,
    },
    {
      title: '任务状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const config = taskStatusMap[status] || { text: status, color: 'default' }
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '上次执行',
      key: 'last_execution',
      width: 120,
      render: (_, record) => {
        if (record.last_execution && typeof record.last_execution === 'object') {
          const status = record.last_execution.status
          const config = executionStatusMap[status] || { text: status, color: 'default' }
          const startedAt = record.last_execution.started_at
          return (
            <Space direction="vertical" size={0}>
              <Tag color={config.color}>{config.text}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {startedAt ? dayjs(startedAt).format('MM-DD HH:mm:ss') : '-'}
              </Text>
            </Space>
          )
        }
        return <Text type="secondary">暂无</Text>
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date) => date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 320,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => handleTrigger(record.id)}
          >
            执行
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          {record.status === TaskStatus.ACTIVE ? (
            <Button
              type="link"
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={() => handleUpdateStatus(record, TaskStatus.PAUSED)}
            >
              暂停
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => handleUpdateStatus(record, TaskStatus.ACTIVE)}
            >
              启用
            </Button>
          )}
          <Popconfirm
            title="确定删除这个任务吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const executionColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const config = executionStatusMap[status] || { text: status, color: 'default' }
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '退出码',
      dataIndex: 'exit_code',
      key: 'exit_code',
      width: 80,
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 180,
      render: (date) => date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '结束时间',
      dataIndex: 'finished_at',
      key: 'finished_at',
      width: 180,
      render: (date) => date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
  ]

  const renderExecutionDetail = (execution) => {
    if (!execution || typeof execution !== 'object') return null
    return (
      <div style={{ marginTop: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="标准输出 (stdout)">
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 200, overflow: 'auto' }}>
              {execution?.stdout ?? '(无)'}
            </pre>
          </Descriptions.Item>
          <Descriptions.Item label="错误输出 (stderr)">
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 200, overflow: 'auto', color: '#ff4d4f' }}>
              {execution?.stderr ?? '(无)'}
            </pre>
          </Descriptions.Item>
        </Descriptions>
      </div>
    )
  }

  return (
    <div>
      <Card
        title="任务列表"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/create')}>
            创建任务
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={tasks}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="任务详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        onOk={() => setDetailVisible(false)}
        width={1000}
        footer={null}
      >
        {selectedTask && (
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基本信息',
                children: (
                  <Descriptions column={2} bordered>
                    <Descriptions.Item label="ID">{selectedTask.id}</Descriptions.Item>
                    <Descriptions.Item label="任务名称">{selectedTask.name}</Descriptions.Item>
                    <Descriptions.Item label="Cron 表达式">{selectedTask.cron_expression}</Descriptions.Item>
                    <Descriptions.Item label="状态">
                      <Tag color={taskStatusMap[selectedTask.status]?.color || 'default'}>
                        {taskStatusMap[selectedTask.status]?.text || selectedTask.status}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="创建时间" span={2}>
                      {selectedTask.created_at ? dayjs(selectedTask.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="执行命令" span={2}>
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{selectedTask.command}</pre>
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: 'executions',
                label: '执行日志',
                children: (
                  <div>
                    <Table
                      columns={executionColumns}
                      dataSource={executions}
                      rowKey="id"
                      loading={executionsLoading}
                      pagination={{ pageSize: 5 }}
                      expandable={{
                        expandedRowRender: renderExecutionDetail,
                        rowExpandable: () => true,
                        defaultExpandAllRows: false,
                      }}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  )
}

export default TaskList
