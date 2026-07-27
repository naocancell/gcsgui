import { createRouter, createWebHashHistory } from 'vue-router'
import { useStaticStore } from '@/store/staticOptions.js'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('@/components/page/HomePage.vue'),
    },
    {
      path: '/test',
      name: 'Test',
      component: () => import('@/components/RouteOptions.vue'),
    },
    {
      path: '/routeManage',
      name: 'routeManage',
      component: () => import('@/components/page/RouteManagePage.vue'),
    },
    {
      path: '/telemetry',
      name: 'Telemetry',
      component: () => import('@/components/page/TelemetryPage.vue'),
    },
    {
      path: '/linkHealth',
      name: 'LinkHealth',
      component: () => import('@/components/page/LinkHealthPage.vue'),
    },
  ],
})

router.beforeEach((to, from, next) => {
  if (to.name === 'routeManage' || to.path === '/routeManage') {
    const staticStore = useStaticStore()
    staticStore.showRouteManage = true
    next({ name: 'Home' })
  } else {
    next()
  }
})

export default router
