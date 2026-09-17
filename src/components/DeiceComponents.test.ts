import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import fs from 'fs'
import path from 'path'
import DeicePanel from './DeicePanel.vue'
import DeiceView from '@/views/DeiceView.vue'
import ToolbarActions from './toolbar/ToolbarActions.vue'
import Toolbar from './toolbar.vue'

// Mock tauri API for DeiceView
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn().mockResolvedValue(false),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
    onResized: vi.fn().mockResolvedValue(vi.fn()),
  }),
}))

const onMountedSpy = vi.fn((fn: () => unknown) => {
  void fn()
})
const onBeforeUnmountSpy = vi.fn((fn: () => unknown) => {
  // 记录注销回调
})

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useSSRContext: () => ({ modules: new Set() }),
    onMounted: (fn: () => unknown) => onMountedSpy(fn),
    onBeforeUnmount: (fn: () => unknown) => onBeforeUnmountSpy(fn),
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => ({
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    }),
  }
})

describe('防除冰系统组件与视图集成测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    onMountedSpy.mockClear()
    onBeforeUnmountSpy.mockClear()
  })

  it('DeicePanel.vue 应导出合法的 Vue 3 组件对象且成功执行 setup 无异常', () => {
    expect(DeicePanel).toBeDefined()
    expect(typeof DeicePanel === 'object' || typeof DeicePanel === 'function').toBe(true)
    const setupFn = (DeicePanel as any).setup
    expect(setupFn).toBeDefined()

    // 验证 setup 执行且 onBeforeUnmount 正确注册
    const emit = vi.fn()
    const expose = vi.fn()
    const result = setupFn({ standalone: true, maximized: false }, { emit, expose })
    expect(result).toBeDefined()
    expect(onBeforeUnmountSpy).toHaveBeenCalled()
  })

  it('DeiceView.vue 应导出合法的顶级视图组件且 setup 与生命周期安全执行', () => {
    expect(DeiceView).toBeDefined()
    expect(typeof DeiceView === 'object' || typeof DeiceView === 'function').toBe(true)
    const setupFn = (DeiceView as any).setup
    expect(setupFn).toBeDefined()

    const emit = vi.fn()
    const expose = vi.fn()
    const result = setupFn({}, { emit, expose })
    expect(result).toBeDefined()
    expect(onMountedSpy).toHaveBeenCalled()
    expect(onBeforeUnmountSpy).toHaveBeenCalled()
  })

  it('DeicePanel.vue 源码应包含健壮的十六进制格式化、同步码动态渲染与错误告警样式类', () => {
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, 'DeicePanel.vue'),
      'utf-8',
    )
    expect(fileContent).toContain("import { ref, computed, onBeforeUnmount } from 'vue'")
    expect(fileContent).toContain("toString(16).toUpperCase().padStart(padLength, '0')")
    expect(fileContent).toContain('.mode-offline')
    expect(fileContent).toContain('.mode-default')
    expect(fileContent).toContain('.pill-danger')
    expect(fileContent).toContain('formatFixed')
    expect(fileContent).toContain('formatHex')
    expect(fileContent).toContain('formatInt')
    expect(fileContent).toContain('syncCodeText')
    expect(fileContent).toContain(':title="alarm.desc"')
    expect(fileContent).toContain('.panel-body::-webkit-scrollbar')
  })

  it('DeicePanel.vue setup 支持非 standalone 浮动面板模式并计算 fixed 坐标与层级', () => {
    const setupFn = (DeicePanel as any).setup
    const emit = vi.fn()
    const expose = vi.fn()
    const instance = setupFn({ standalone: false, maximized: false }, { emit, expose })

    expect(instance).toBeDefined()
    expect(instance.panelStyle).toBeDefined()
    const style = instance.panelStyle.value ?? instance.panelStyle
    expect(style.position).toBe('fixed')
    expect(style.zIndex).toBe(2000)
    expect(style.left).toContain('px')
    expect(style.top).toContain('px')

    const syncCode = instance.syncCodeText.value ?? instance.syncCodeText
    expect(syncCode).toBe('0xEB 0x90')
  })

  it('ToolbarActions.vue 应声明 showDeice 自定义事件', () => {
    expect(ToolbarActions).toBeDefined()
    const emits = (ToolbarActions as any).emits
    expect(emits).toBeDefined()
    expect(emits).toContain('showDeice')
  })

  it('ToolbarActions.vue 模板源码应包含防除冰系统按钮与 Tooltip', () => {
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, 'toolbar/ToolbarActions.vue'),
      'utf-8',
    )
    expect(fileContent).toContain('防除冰系统')
    expect(fileContent).toContain("$emit('showDeice')")
    expect(fileContent).toContain('<SnowOutline />')
  })

  it('toolbar.vue 顶层组件应正确接入并绑定 openOrRestoreDeiceWindow 处理器', () => {
    const fileContent = fs.readFileSync(
      path.resolve(__dirname, 'toolbar.vue'),
      'utf-8',
    )
    expect(fileContent).toContain("import { openOrRestoreDeiceWindow } from '@/utils/deiceWindow'")
    expect(fileContent).toContain('@show-deice="openOrRestoreDeiceWindow"')
  })
})
