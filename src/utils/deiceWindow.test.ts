import { beforeEach, describe, expect, it, vi } from 'vitest'

const getByLabel = vi.fn()
const WebviewWindowCtor = vi.fn()

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(
    function WebviewWindow(...args: unknown[]) {
      WebviewWindowCtor(...args)
    },
    { getByLabel: (...args: unknown[]) => getByLabel(...args) },
  ),
}))

vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}))

const isTauriMock = vi.fn().mockReturnValue(true)

vi.mock('@/utils/homeWindowData', () => ({
  isTauri: () => isTauriMock(),
}))

import {
  openOrRestoreDeiceWindow,
  restoreDeiceWindow,
  hideDeiceWindow,
  preserveDeiceWindowOnClose,
  deiceWindowOptions,
} from './deiceWindow'

describe('deiceWindow 工具函数测试', () => {
  beforeEach(() => {
    getByLabel.mockReset()
    WebviewWindowCtor.mockReset()
  })

  it('配置项正确声明 /deice 路由与标题尺寸', () => {
    expect(deiceWindowOptions.url).toBe('index.html#/deice')
    expect(deiceWindowOptions.title).toBe('防除冰系统监控 - DEICE MONITOR')
    expect(deiceWindowOptions.width).toBeGreaterThanOrEqual(840)
    expect(deiceWindowOptions.height).toBeGreaterThanOrEqual(600)
    expect(deiceWindowOptions.decorations).toBe(false)
  })

  it('已存在窗口时只恢复显示与焦点，不重新实例化', async () => {
    const existing = {
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    }
    getByLabel.mockResolvedValue(existing)

    await openOrRestoreDeiceWindow()

    expect(existing.unminimize).toHaveBeenCalled()
    expect(existing.show).toHaveBeenCalled()
    expect(existing.setFocus).toHaveBeenCalled()
    expect(WebviewWindowCtor).not.toHaveBeenCalled()
  })

  it('窗口不存在时创建新的 WebviewWindow 实例', async () => {
    getByLabel.mockResolvedValue(null)

    await openOrRestoreDeiceWindow()

    expect(WebviewWindowCtor).toHaveBeenCalledWith('deice', deiceWindowOptions)
  })

  it('restoreDeiceWindow 传入现有窗口对象时直接恢复', async () => {
    const mockWin = {
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    }

    await restoreDeiceWindow(mockWin)

    expect(mockWin.unminimize).toHaveBeenCalled()
    expect(mockWin.show).toHaveBeenCalled()
    expect(mockWin.setFocus).toHaveBeenCalled()
  })

  it('hideDeiceWindow 与 preserveDeiceWindowOnClose 能正确隐藏窗口并阻止默认关闭', async () => {
    const mockWin = {
      hide: vi.fn().mockResolvedValue(undefined),
    }
    const mockEvent = {
      preventDefault: vi.fn(),
    }

    await hideDeiceWindow(mockWin)
    expect(mockWin.hide).toHaveBeenCalled()

    await preserveDeiceWindowOnClose(mockEvent, mockWin)
    expect(mockEvent.preventDefault).toHaveBeenCalled()
    expect(mockWin.hide).toHaveBeenCalledTimes(2)
  })

  it('非桌面纯 Web 浏览器环境时安全降级为 window.open', async () => {
    isTauriMock.mockReturnValue(false)
    const openMock = vi.fn()
    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = { open: openMock }

    try {
      await openOrRestoreDeiceWindow()

      expect(openMock).toHaveBeenCalledWith(
        deiceWindowOptions.url,
        'deice',
        `width=${deiceWindowOptions.width},height=${deiceWindowOptions.height}`,
      )
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as any).window
      } else {
        ;(globalThis as any).window = originalWindow
      }
      isTauriMock.mockReturnValue(true)
    }
  })
})
