import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router, { routes } from './index'
import { createRouter, createMemoryHistory, createWebHashHistory } from 'vue-router'
import { useStaticStore } from '@/store/staticStore'
import fs from 'fs'
import path from 'path'

describe('EMPIRICAL CHALLENGER: Router & Views Adversarial Suite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('1. 路由表完备性与防御性验证 (Route Table & Definitions)', () => {
    it('路由配置必须为严格的6个标准路径，无未定义或冗余路由', () => {
      const paths = routes.map((r) => r.path)
      const names = routes.map((r) => r.name)

      expect(paths).toEqual(['/', '/routeManage', '/telemetry', '/pod', '/linkHealth', '/deice'])
      expect(names).toEqual(['Home', 'RouteManage', 'Telemetry', 'Pod', 'LinkHealth', 'Deice'])
      expect(routes).toHaveLength(6)

      // 绝不允许包含 /test、/RouteOptions 等未规范路由
      expect(paths).not.toContain('/test')
      expect(paths).not.toContain('/RouteOptions')
      expect(paths).not.toContain('/home')
    })

    it('所有路由必须包含正确的 meta.title 信息', () => {
      const titles = routes.map((r) => r.meta?.title)
      expect(titles).toEqual([
        '主页 - GCS 地面站',
        '航线管理 - GCS 地面站',
        '无人机航电系统 - UAV AVIONICS',
        '光电吊舱控制 - POD CONTROL',
        '链路状态信息 - LINK HEALTH',
        '防除冰系统监控 - DEICE MONITOR',
      ])
    })

    it('所有路由的组件加载器必须为函数', () => {
      for (const route of routes) {
        expect(typeof route.component).toBe('function')
      }
    })
  })

  describe('2. 路由解析与伪拦截移除验证 (Route Resolution & No Fake Interception)', () => {
    it('路由解析 /routeManage 应匹配 RouteManage 且 matched[0].name 正确', () => {
      const resolved = router.resolve('/routeManage')
      expect(resolved.path).toBe('/routeManage')
      expect(resolved.name).toBe('RouteManage')
      expect(resolved.matched.length).toBeGreaterThan(0)
      expect(resolved.matched[0].name).toBe('RouteManage')
      expect(resolved.matched[0].path).toBe('/routeManage')
    })

    it('路由解析 /telemetry 和 /linkHealth 能正确匹配对应顶级路由与元信息', () => {
      const resolvedTelemetry = router.resolve('/telemetry')
      expect(resolvedTelemetry.path).toBe('/telemetry')
      expect(resolvedTelemetry.name).toBe('Telemetry')
      expect(resolvedTelemetry.meta.title).toBe('无人机航电系统 - UAV AVIONICS')

      const resolvedLinkHealth = router.resolve('/linkHealth')
      expect(resolvedLinkHealth.path).toBe('/linkHealth')
      expect(resolvedLinkHealth.name).toBe('LinkHealth')
      expect(resolvedLinkHealth.meta.title).toBe('链路状态信息 - LINK HEALTH')
    })

    it('支持标准路由名称解析 router.resolve({ name: ... })', () => {
      const homeResolved = router.resolve({ name: 'Home' })
      expect(homeResolved.path).toBe('/')
      expect(homeResolved.name).toBe('Home')

      const routeManageResolved = router.resolve({ name: 'RouteManage' })
      expect(routeManageResolved.path).toBe('/routeManage')
      expect(routeManageResolved.name).toBe('RouteManage')

      const telemetryResolved = router.resolve({ name: 'Telemetry' })
      expect(telemetryResolved.path).toBe('/telemetry')
      expect(telemetryResolved.name).toBe('Telemetry')

      const podResolved = router.resolve({ name: 'Pod' })
      expect(podResolved.path).toBe('/pod')
      expect(podResolved.name).toBe('Pod')

      const linkHealthResolved = router.resolve({ name: 'LinkHealth' })
      expect(linkHealthResolved.path).toBe('/linkHealth')
      expect(linkHealthResolved.name).toBe('LinkHealth')

      const deiceResolved = router.resolve({ name: 'Deice' })
      expect(deiceResolved.path).toBe('/deice')
      expect(deiceResolved.name).toBe('Deice')
    })

    it('非预期路径应正确解析为未匹配 (matched 数组为空)', () => {
      const resolvedInvalid = router.resolve('/nonExistentRoute123')
      expect(resolvedInvalid.matched).toHaveLength(0)

      const resolvedOldTest = router.resolve('/test')
      expect(resolvedOldTest.matched).toHaveLength(0)
    })
  })

  describe('3. 导航行为与多窗口兼容性测试 (Navigation & Multi-window)', () => {
    it('使用 MemoryHistory 验证真实路由 push 导航与状态持久性（无伪重定向）', async () => {
      // 使用 lightweight component stubs 模拟视图挂载，验证路由流转
      const testRoutes = routes.map((r) => ({
        ...r,
        component: { name: `${String(r.name)}ViewStub`, template: '<div></div>' },
      }))

      const memRouter = createRouter({
        history: createMemoryHistory(),
        routes: testRoutes,
      })

      // 初始导航至 /
      await memRouter.push('/')
      expect(memRouter.currentRoute.value.path).toBe('/')
      expect(memRouter.currentRoute.value.name).toBe('Home')

      // 导航至 /routeManage - 验证独立路由状态被保留，未发生 fake redirect
      await memRouter.push('/routeManage')
      expect(memRouter.currentRoute.value.path).toBe('/routeManage')
      expect(memRouter.currentRoute.value.name).toBe('RouteManage')

      // 导航至 /telemetry (独立航电窗口)
      await memRouter.push('/telemetry')
      expect(memRouter.currentRoute.value.path).toBe('/telemetry')
      expect(memRouter.currentRoute.value.name).toBe('Telemetry')
      expect(memRouter.currentRoute.value.meta.title).toBe('无人机航电系统 - UAV AVIONICS')

      // 导航至 /linkHealth (独立链路状态窗口)
      await memRouter.push('/linkHealth')
      expect(memRouter.currentRoute.value.path).toBe('/linkHealth')
      expect(memRouter.currentRoute.value.name).toBe('LinkHealth')
      expect(memRouter.currentRoute.value.meta.title).toBe('链路状态信息 - LINK HEALTH')

      // 导航至 /deice (独立防除冰系统监控窗口)
      await memRouter.push('/deice')
      expect(memRouter.currentRoute.value.path).toBe('/deice')
      expect(memRouter.currentRoute.value.name).toBe('Deice')
      expect(memRouter.currentRoute.value.meta.title).toBe('防除冰系统监控 - DEICE MONITOR')

      // 导航回 Home
      await memRouter.push('/')
      expect(memRouter.currentRoute.value.path).toBe('/')
      expect(memRouter.currentRoute.value.name).toBe('Home')
    })

    it('处理带 query 参数与 hash 锚点的 URL 解析', () => {
      const resolvedWithQuery = router.resolve('/telemetry?droneId=uav-01&debug=true')
      expect(resolvedWithQuery.path).toBe('/telemetry')
      expect(resolvedWithQuery.query).toEqual({ droneId: 'uav-01', debug: 'true' })
      expect(resolvedWithQuery.name).toBe('Telemetry')

      const resolvedWithHash = router.resolve('/linkHealth#diagnostics')
      expect(resolvedWithHash.path).toBe('/linkHealth')
      expect(resolvedWithHash.hash).toBe('#diagnostics')
      expect(resolvedWithHash.name).toBe('LinkHealth')

      const resolvedDeiceHash = router.resolve('/deice#alarms')
      expect(resolvedDeiceHash.path).toBe('/deice')
      expect(resolvedDeiceHash.hash).toBe('#alarms')
      expect(resolvedDeiceHash.name).toBe('Deice')
    })
  })

  describe('4. 文件系统与组件引用规范性验证 (File System & Import Integrity)', () => {
    const srcDir = path.resolve(__dirname, '..')

    it('所有核心视图文件必须存在于 src/views/', () => {
      const viewsDir = path.join(srcDir, 'views')
      const expectedFiles = [
        'HomeView.vue',
        'RouteManageView.vue',
        'TelemetryView.vue',
        'LinkHealthView.vue',
        'DeiceView.vue',
      ]

      for (const file of expectedFiles) {
        expect(fs.existsSync(path.join(viewsDir, file))).toBe(true)
      }
    })

    it('向后兼容的 Page 别名文件必须存在于 src/views/', () => {
      const viewsDir = path.join(srcDir, 'views')
      const aliasFiles = [
        'HomePage.vue',
        'RouteManagePage.vue',
        'TelemetryPage.vue',
        'LinkHealthPage.vue',
        'DeicePage.vue',
      ]

      for (const file of aliasFiles) {
        expect(fs.existsSync(path.join(viewsDir, file))).toBe(true)
      }
    })

    it('遗留目录 src/components/page/ 和遗留文件 src/router/index.js 必须已彻底删除', () => {
      const oldPagesDir = path.join(srcDir, 'components', 'page')
      const oldRouterJs = path.join(srcDir, 'router', 'index.js')

      expect(fs.existsSync(oldPagesDir)).toBe(false)
      expect(fs.existsSync(oldRouterJs)).toBe(false)
    })

    it('源码中不应存在任何引用 components/page 的遗留路径', () => {
      function scanDirectory(dir: string): string[] {
        const results: string[] = []
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git') {
              results.push(...scanDirectory(fullPath))
            }
          } else if (/\.(vue|ts|js|json|html)$/.test(entry.name)) {
            // 跳过测试文件自身中对遗留路径的历史检查字符串
            if (!entry.name.includes('test.ts')) {
              const content = fs.readFileSync(fullPath, 'utf-8')
              if (content.includes('components/page')) {
                results.push(fullPath)
              }
            }
          }
        }
        return results
      }

      const badReferences = scanDirectory(srcDir)
      expect(badReferences).toEqual([])
    })
  })
})
