import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/main.scss'
import { useAuthStore } from './stores/auth'
import axios from 'axios'

axios.defaults.baseURL = '/'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(ElementPlus)

const authStore = useAuthStore()
authStore.initAuth()

app.mount('#app')