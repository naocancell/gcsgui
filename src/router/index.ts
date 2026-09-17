import {
  createRouter,
  createWebHashHistory,
  createMemoryHistory,
  type RouteRecordRaw,
} from 'vue-router'

/**
 * 地面站前端核心路由配置表
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue'),
    meta: {
      title: '主页 - GCS 地面站',
    },
  },
  {
    path: '/routeManage',
    name: 'RouteManage',
    component: () => import('@/views/RouteManageView.vue'),
    meta: {
      title: '航线管理 - GCS 地面站',
    },
  },
  {
    path: '/telemetry',
    name: 'Telemetry',
    component: () => import('@/views/TelemetryView.vue'),
    meta: {
      title: '无人机航电系统 - UAV AVIONICS',
    },
  },
  {
    path: '/pod',
    name: 'Pod',
    component: () => import('@/views/PodView.vue'),
    meta: {
      title: '光电吊舱控制 - POD CONTROL',
    },
  },
  {
    path: '/linkHealth',
    name: 'LinkHealth',
    component: () => import('@/views/LinkHealthView.vue'),
    meta: {
      title: '链路状态信息 - LINK HEALTH',
    },
  },
  {
    path: '/deice',
    name: 'Deice',
    component: () => import('@/views/DeiceView.vue'),
    meta: {
      title: '防除冰系统监控 - DEICE MONITOR',
    },
  },
]

/**
 * Vue Router 实例 (使用 WebHashHistory 适配 Tauri 桌面端与跨窗口，Node/测试环境下安全降级为 MemoryHistory)
 */
const routerHistory =
  typeof window !== 'undefined'
    ? createWebHashHistory(import.meta.env.BASE_URL)
    : createMemoryHistory(import.meta.env.BASE_URL)

const router = createRouter({
  history: routerHistory,
  routes,
})

export default router
