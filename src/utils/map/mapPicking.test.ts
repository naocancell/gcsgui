import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isExclusiveMapPicking, setStartupLocationPicking } from './mapPicking'

function stubWindow() {
  vi.stubGlobal('window', {
    guidancePointPicking: false,
    startupLocationPicking: false,
  })
}

describe('mapPicking 互斥标志', () => {
  beforeEach(() => {
    stubWindow()
    setStartupLocationPicking(false)
    window.guidancePointPicking = false
  })

  afterEach(() => {
    setStartupLocationPicking(false)
    window.guidancePointPicking = false
  })

  it('默认不互斥', () => {
    expect(isExclusiveMapPicking()).toBe(false)
  })

  it('启动点选点期间应互斥其它地图左键拾取', () => {
    setStartupLocationPicking(true)
    expect(window.startupLocationPicking).toBe(true)
    expect(isExclusiveMapPicking()).toBe(true)

    setStartupLocationPicking(false)
    expect(window.startupLocationPicking).toBe(false)
    expect(isExclusiveMapPicking()).toBe(false)
  })

  it('引导点选点期间同样互斥', () => {
    window.guidancePointPicking = true
    expect(isExclusiveMapPicking()).toBe(true)
  })
})
