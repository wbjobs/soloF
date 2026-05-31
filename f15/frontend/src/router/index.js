import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('@/views/Dashboard.vue')
  },
  {
    path: '/workflows',
    name: 'Workflows',
    component: () => import('@/views/Workflows.vue')
  },
  {
    path: '/editor',
    name: 'Editor',
    component: () => import('@/views/DAGEditor.vue')
  },
  {
    path: '/editor/:id',
    name: 'EditorEdit',
    component: () => import('@/views/DAGEditor.vue')
  },
  {
    path: '/executions',
    name: 'Executions',
    component: () => import('@/views/Executions.vue')
  },
  {
    path: '/executions/:id',
    name: 'ExecutionDetail',
    component: () => import('@/views/ExecutionDetail.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router