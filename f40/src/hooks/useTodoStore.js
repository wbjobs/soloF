import { useState, useEffect, useCallback } from 'react'
import { yDocStore } from '../store/ydoc'

export function useTodoStore() {
  const [state, setState] = useState(() => yDocStore.getState())

  useEffect(() => {
    return yDocStore.subscribe((newState) => {
      setState(newState)
    })
  }, [])

  const addTodo = (text) => {
    if (text.trim()) {
      yDocStore.addTodo(text.trim())
    }
  }

  const toggleTodo = (id) => {
    yDocStore.toggleTodo(id)
  }

  const deleteTodo = (id) => {
    yDocStore.deleteTodo(id)
  }

  const updateTodoText = (id, text) => {
    if (text.trim()) {
      yDocStore.updateTodoText(id, text.trim())
    }
  }

  const reorderTodos = (fromIndex, toIndex) => {
    yDocStore.reorderTodos(fromIndex, toIndex)
  }

  const getAvailableTimePoints = useCallback(() => {
    return yDocStore.getAvailableTimePoints()
  }, [])

  const travelToTimePoint = useCallback((targetTime) => {
    return yDocStore.travelToTimePoint(targetTime)
  }, [])

  const exitTimeMachine = useCallback(() => {
    yDocStore.exitTimeMachine()
  }, [])

  const isInTimeMachine = useCallback(() => {
    return yDocStore.isInTimeMachine()
  }, [])

  return {
    todos: state.todos,
    connectionStatus: state.connectionStatus,
    isTimeMachine: state.isTimeMachine,
    currentTimePoint: state.currentTimePoint,
    addTodo,
    toggleTodo,
    deleteTodo,
    updateTodoText,
    reorderTodos,
    getAvailableTimePoints,
    travelToTimePoint,
    exitTimeMachine,
    isInTimeMachine
  }
}
