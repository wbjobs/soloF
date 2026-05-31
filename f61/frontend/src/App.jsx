import React from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import TaskList from './pages/TaskList.jsx'
import CreateTask from './pages/CreateTask.jsx'

const { Header, Content } = Layout

const App = () => {
  const location = useLocation()

  const menuItems = [
    { key: '/', label: <Link to="/">任务列表</Link> },
    { key: '/create', label: <Link to="/create">创建任务</Link> },
  ]

  const selectedKey = location.pathname === '/create' ? '/create' : '/'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ color: 'white', fontSize: '18px', fontWeight: 'bold', marginRight: '40px' }}>
          分布式任务调度平台
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content style={{ padding: '24px' }}>
        <div style={{ background: '#fff', padding: 24, minHeight: 'calc(100vh - 112px)' }}>
          <Routes>
            <Route path="/" element={<TaskList />} />
            <Route path="/create" element={<CreateTask />} />
          </Routes>
        </div>
      </Content>
    </Layout>
  )
}

export default App
