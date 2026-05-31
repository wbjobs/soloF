import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Analyze from '../views/Analyze.vue'
import Optimize from '../views/Optimize.vue'
import Blocks from '../views/Blocks.vue'
import Cache from '../views/Cache.vue'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard
  },
  {
    path: '/analyze',
    name: 'Analyze',
    component: Analyze
  },
  {
    path: '/optimize',
    name: 'Optimize',
    component: Optimize
  },
  {
    path: '/blocks',
    name: 'Blocks',
    component: Blocks
  },
  {
    path: '/cache',
    name: 'Cache',
    component: Cache
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
