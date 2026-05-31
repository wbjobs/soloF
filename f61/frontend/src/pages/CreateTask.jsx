import React from 'react'
import { Form, Input, Button, Card, message, Space } from 'antd'
import { useNavigate } from 'react-router-dom'
import { taskAPI } from '../services/api.js'

const { TextArea } = Input

const CreateTask = () => {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const [loading, setLoading] = React.useState(false)

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      await taskAPI.createTask(values)
      message.success('任务创建成功')
      navigate('/')
    } catch (error) {
      message.error(error.response?.data?.error || '任务创建失败')
    } finally {
      setLoading(false)
    }
  }

  const cronExamples = [
    { label: '每分钟', value: '* * * * *' },
    { label: '每小时', value: '0 * * * *' },
    { label: '每天0点', value: '0 0 * * *' },
    { label: '每周一0点', value: '0 0 * * 1' },
  ]

  return (
    <Card title="创建定时任务">
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ maxWidth: 800 }}
      >
        <Form.Item
          name="name"
          label="任务名称"
          rules={[{ required: true, message: '请输入任务名称' }]}
        >
          <Input placeholder="请输入任务名称" maxLength={255} />
        </Form.Item>

        <Form.Item
          name="cron_expression"
          label="Cron 表达式"
          rules={[{ required: true, message: '请输入Cron表达式' }]}
          extra={
            <Space>
              常用表达式：
              {cronExamples.map((item) => (
                <Button
                  key={item.value}
                  type="link"
                  size="small"
                  onClick={() => form.setFieldValue('cron_expression', item.value)}
                >
                  {item.label}
                </Button>
              ))}
            </Space>
          }
        >
          <Input placeholder="例如: * * * * * (每分钟执行)" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="command"
          label="Shell 命令"
          rules={[{ required: true, message: '请输入要执行的命令' }]}
        >
          <TextArea
            rows={4}
            placeholder="请输入要执行的Shell命令，例如: echo Hello World"
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              创建任务
            </Button>
            <Button onClick={() => navigate('/')}>取消</Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  )
}

export default CreateTask
