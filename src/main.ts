import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'
import 'virtual:svg-icons-register'
import naive from 'naive-ui'
import router from './router'
if (typeof window !== 'undefined') {
  window.CESIUM_BASE_URL = import.meta.env.DEV ? '/Cesium/' : './Cesium/'
}

const pinia = createPinia()
const app = createApp(App)
app.use(router)
app.use(naive)
app.use(pinia)
app.mount('#app')
