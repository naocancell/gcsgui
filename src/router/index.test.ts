import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import router, { routes } from './index'

describe('路由系统与视图层规范化测试 (Router & View Layer)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('应该包含规范化的4个标准顶级路由且不包含冗余/test路由', () => {
    const paths = routes.map((r) => r.path)
    const names = routes.map((r) => r.name)

    // 验证包含正确的4个核心路由
    expect(paths).toContain('/')
    expect(paths).toContain('/routeManage')
    expect(paths).toContain('/telemetry')
    expect(paths).toContain('/linkHealth')

    expect(names).toContain('Home')
    expect(names).toContain('RouteManage')
    expect(names).toContain('Telemetry')
    expect(names).toContain('LinkHealth')

    // 验证废弃的调试路由/test已被彻底移除
    expect(paths).not.toContain('/test')
    expect(names).not.toContain('Test')
    expect(routes.length).toBe(4)
  })

  it('每个路由应该配置了正确的元信息和组件加载器', () => {
    const homeRoute = routes.find((r) => r.path === '/')
    expect(homeRoute).toBeDefined()
    expect(homeRoute?.name).toBe('Home')
    expect(homeRoute?.meta?.title).toBe('主页 - GCS 地面站')
    expect(typeof homeRoute?.component).toBe('function')

    const routeManageRoute = routes.find((r) => r.path === '/routeManage')
    expect(routeManageRoute).toBeDefined()
    expect(routeManageRoute?.name).toBe('RouteManage')
    expect(routeManageRoute?.meta?.title).toBe('航线管理 - GCS 地面站')
    expect(typeof routeManageRoute?.component).toBe('function')

    const telemetryRoute = routes.find((r) => r.path === '/telemetry')
    expect(telemetryRoute).toBeDefined()
    expect(telemetryRoute?.name).toBe('Telemetry')
    expect(telemetryRoute?.meta?.title).toBe('无人机航电系统 - UAV AVIONICS')
    expect(typeof telemetryRoute?.component).toBe('function')

    const linkHealthRoute = routes.find((r) => r.path === '/linkHealth')
    expect(linkHealthRoute).toBeDefined()
    expect(linkHealthRoute?.name).toBe('LinkHealth')
    expect(linkHealthRoute?.meta?.title).toBe('链路状态信息 - LINK HEALTH')
    expect(typeof linkHealthRoute?.component).toBe('function')
  })

  it('路由解析 /routeManage 应匹配 RouteManage 而不是被伪拦截重定向到 Home', () => {
    const resolved = router.resolve('/routeManage')
    expect(resolved.path).toBe('/routeManage')
    expect(resolved.name).toBe('RouteManage')
    expect(resolved.matched.length).toBeGreaterThan(0)
    expect(resolved.matched[0].name).toBe('RouteManage')
  })

  it('路由解析 /telemetry 和 /linkHealth 能正确匹配对应顶级路由', () => {
    const resolvedTelemetry = router.resolve('/telemetry')
    expect(resolvedTelemetry.path).toBe('/telemetry')
    expect(resolvedTelemetry.name).toBe('Telemetry')

    const resolvedLinkHealth = router.resolve('/linkHealth')
    expect(resolvedLinkHealth.path).toBe('/linkHealth')
    expect(resolvedLinkHealth.name).toBe('LinkHealth')
  })

  it('验证所有 4 个 view 文件在 src/views/ 中存在且路径规范', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const viewsDir = path.resolve(__dirname, '../views')
    expect(fs.existsSync(path.join(viewsDir, 'HomeView.vue'))).toBe(true)
    expect(fs.existsSync(path.join(viewsDir, 'RouteManageView.vue'))).toBe(true)
    expect(fs.existsSync(path.join(viewsDir, 'TelemetryView.vue'))).toBe(true)
    expect(fs.existsSync(path.join(viewsDir, 'LinkHealthView.vue'))).toBe(true)

    // 验证旧目录已被彻底删除
    const oldPagesDir = path.resolve(__dirname, '../components/page')
    expect(fs.existsSync(oldPagesDir)).toBe(false)
  })
})
