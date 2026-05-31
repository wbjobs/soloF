import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomePage.vue')
  },
  {
    path: '/room/:roomId',
    name: 'Room',
    component: () => import('@/views/RoomPage.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
