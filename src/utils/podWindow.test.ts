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

vi.mock('@/utils/homeWindowData', () => ({
  isTauri: () => true,
}))

import { openOrRestorePodWindow } from './podWindow'

describe('openOrRestorePodWindow', () => {
  beforeEach(() => {
    getByLabel.mockReset()
    WebviewWindowCtor.mockReset()
  })

  it('已存在窗口时只恢复显示，不强制 setSize 回预设尺寸', async () => {
    const existing = {
      setSize: vi.fn(),
      unminimize: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    }
    getByLabel.mockResolvedValue(existing)

    await openOrRestorePodWindow()

    expect(existing.setSize).not.toHaveBeenCalled()
    expect(existing.unminimize).toHaveBeenCalled()
    expect(existing.show).toHaveBeenCalled()
    expect(existing.setFocus).toHaveBeenCalled()
    expect(WebviewWindowCtor).not.toHaveBeenCalled()
  })
})
