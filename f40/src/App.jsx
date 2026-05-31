import { useState, useMemo } from 'react'
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd'
import { useTodoStore } from './hooks/useTodoStore'

function App() {
  const {
    todos,
    connectionStatus,
    isTimeMachine,
    currentTimePoint,
    addTodo,
    toggleTodo,
    deleteTodo,
    reorderTodos,
    getAvailableTimePoints,
    travelToTimePoint,
    exitTimeMachine
  } = useTodoStore()
  const [inputValue, setInputValue] = useState('')
  const [showTimeMachine, setShowTimeMachine] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (inputValue.trim()) {
      addTodo(inputValue)
      setInputValue('')
    }
  }

  const handleDragEnd = (result) => {
    if (!result.destination) return
    
    const { source, destination } = result
    if (source.index !== destination.index) {
      reorderTodos(source.index, destination.index)
    }
  }

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return '已连接'
      case 'connecting':
        return '连接中...'
      case 'offline':
        return '离线模式'
      default:
        return '未知状态'
    }
  }

  const completedCount = todos.filter(t => t.completed).length
  const totalCount = todos.length

  const timePoints = useMemo(() => {
    const points = getAvailableTimePoints()
    return points.length > 0 ? points : [Date.now()]
  }, [todos, getAvailableTimePoints])

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleTimeChange = (e) => {
    const index = parseInt(e.target.value)
    if (index >= 0 && index < timePoints.length) {
      travelToTimePoint(timePoints[index])
    }
  }

  const handleExitTimeMachine = () => {
    exitTimeMachine()
    setShowTimeMachine(false)
  }

  return (
    <div className="app">
      <div className="header">
        <h1>待办清单</h1>
        <div className={`connection-status ${connectionStatus}`}>
          <span className="status-dot"></span>
          {getStatusText()}
        </div>
      </div>

      {isTimeMachine && (
        <div className="time-machine-banner">
          <span className="time-machine-icon">⏰</span>
          <span className="time-machine-text">
            历史时光机 - {formatTime(currentTimePoint)}
          </span>
          <button className="exit-time-machine" onClick={handleExitTimeMachine}>
            返回当前
          </button>
        </div>
      )}

      <div className="time-machine-controls">
        <button
          className={`time-machine-toggle ${showTimeMachine ? 'active' : ''}`}
          onClick={() => {
            if (isTimeMachine) {
              handleExitTimeMachine()
            } else {
              setShowTimeMachine(!showTimeMachine)
            }
          }}
        >
          ⏰ 历史时光机
        </button>
        
        {showTimeMachine && !isTimeMachine && (
          <div className="time-machine-panel">
            <div className="time-machine-header">
              <span>选择历史时间点</span>
              <span className="time-range">过去 24 小时</span>
            </div>
            <div className="time-slider-container">
              <input
                type="range"
                min="0"
                max={timePoints.length - 1}
                defaultValue={timePoints.length - 1}
                onChange={handleTimeChange}
                className="time-slider"
              />
              <div className="time-labels">
                <span>{formatTime(timePoints[0])}</span>
                <span>{formatTime(timePoints[timePoints.length - 1])}</span>
              </div>
            </div>
            <p className="time-machine-hint">
              拖动滑块查看历史状态，将自动进入只读模式
            </p>
          </div>
        )}
      </div>

      <form className={`todo-form ${isTimeMachine ? 'disabled' : ''}`} onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder={isTimeMachine ? "时光机模式下无法添加任务" : "添加新任务..."}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isTimeMachine}
        />
      </form>

      <div className="todo-list">
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="todos">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef}>
                {todos.length === 0 ? (
                  <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                    </svg>
                    <p>暂无任务，添加一个吧！</p>
                  </div>
                ) : (
                  todos.map((todo, index) => (
                    <Draggable
                      key={todo.id}
                      draggableId={todo.id}
                      index={index}
                      isDragDisabled={isTimeMachine}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`todo-item ${snapshot.isDragging ? 'dragging' : ''} ${isTimeMachine ? 'disabled' : ''}`}
                        >
                          <span className="drag-handle" {...provided.dragHandleProps}>
                            ⋮⋮
                          </span>
                          <label className="todo-checkbox">
                            <input
                              type="checkbox"
                              checked={todo.completed}
                              onChange={() => toggleTodo(todo.id)}
                              disabled={isTimeMachine}
                            />
                            <span className="checkmark"></span>
                          </label>
                          <span className={`todo-text ${todo.completed ? 'completed' : ''}`}>
                            {todo.text}
                          </span>
                          {!isTimeMachine && (
                            <button
                              type="button"
                              className="todo-delete"
                              onClick={() => deleteTodo(todo.id)}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      )}
                    </Draggable>
                  ))
                )}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {totalCount > 0 && (
          <div className="stats">
            <span>总计: {totalCount} 项</span>
            <span>已完成: {completedCount} 项</span>
            <span>待完成: {totalCount - completedCount} 项</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
