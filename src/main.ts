import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { createPinia } from 'pinia'
import 'virtual:svg-icons-register'
import naive from 'naive-ui'
import router from './router'
import { logger } from './utils/logger'

if (typeof window !== 'undefined') {
  window.CESIUM_BASE_URL = import.meta.env.DEV ? '/Cesium/' : './Cesium/'

  // 1. 全局未捕获 Promise 异常兜底
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('前端未捕获的异步 Promise 异常:', event.reason)
  })

  // 2. 全局运行时脚本错误捕获
  window.addEventListener('error', (event) => {
    logger.error(`前端未捕获的运行时脚本错误 [${event.filename}:${event.lineno}:${event.colno}]:`, event.message, event.error)
  })
}

const pinia = createPinia()
const app = createApp(App)

// 3. 全局 Vue 组件层异常捕获
app.config.errorHandler = (err, instance, info) => {
  const componentName = instance?.$options?.name || instance?.$options?.__name || 'AnonymousComponent'
  logger.error(`[Vue异常:${componentName}] [钩子:${info}]:`, err)
}

app.use(router)
app.use(naive)
app.use(pinia)
app.mount('#app')

logger.info('=== GCSGUI 前端测控交互界面初始化完毕 ===')
