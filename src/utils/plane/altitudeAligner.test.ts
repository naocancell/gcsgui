import { describe, expect, it, beforeEach } from 'vitest'
import { AltitudeAligner, isPlaneOnGround } from './altitudeAligner'
import type { PlaneState } from '@/types/entityoptions'

describe('altitudeAligner', () => {
  let aligner: AltitudeAligner

  beforeEach(() => {
    aligner = new AltitudeAligner()
  })

  const createMockViewer = (terrainHeight: number) => ({
    scene: {
      globe: {
        getHeight: () => terrainHeight,
      },
    },
  })

  it('场景1：离线无地形（地表 0m），地面静止时精准贴地（渲染高度为 0m）', () => {
    const viewer = createMockViewer(0)
    const plane: PlaneState = {
      id: 'test-1',
      type: 'fp95',
      lon: 110.0,
      lat: 20.0,
      alt: 500.0, // 机场地面海拔 500m
      heading: 0,
      groundSpeed: 0.2, // 静止
      verticalSpeed: 0.0,
      raw: {} as any,
    }

    const renderHeight = aligner.getRenderHeight(plane, viewer)
    expect(renderHeight).toBe(0) // 贴在 0m 地表

    const cal = aligner.getCalibration('test-1')
    expect(cal?.calibrated).toBe(true)
    expect(cal?.deltaH).toBe(500.0)
  })

  it('场景1续：离线无地形，起飞爬升至 600m 时，渲染高度平滑升至 100m', () => {
    const viewer = createMockViewer(0)
    const plane: PlaneState = {
      id: 'test-1',
      type: 'fp95',
      lon: 110.0,
      lat: 20.0,
      alt: 500.0,
      heading: 0,
      groundSpeed: 0.1,
      verticalSpeed: 0.0,
      raw: {} as any,
    }
    // 首次地面标定
    aligner.getRenderHeight(plane, viewer)

    // 起飞爬升
    plane.alt = 600.0
    plane.groundSpeed = 30.0
    plane.verticalSpeed = 3.0

    const renderHeight = aligner.getRenderHeight(plane, viewer)
    expect(renderHeight).toBe(100.0) // 600 - 500 = 100
  })

  it('场景2：联网有 DEM 地形（地表 530m），地面静止时精准贴合跑道网格（530m）', () => {
    const viewer = createMockViewer(530.0) // 采样跑道 DEM 高度 530m
    const plane: PlaneState = {
      id: 'test-2',
      type: 'fp981c',
      lon: 109.5,
      lat: 18.2,
      alt: 500.0, // 飞控海拔 500m
      heading: 90,
      groundSpeed: 0.3,
      verticalSpeed: 0.0,
      raw: {} as any,
    }

    const renderHeight = aligner.getRenderHeight(plane, viewer)
    expect(renderHeight).toBe(530.0) // 贴在 530m 跑道面

    const cal = aligner.getCalibration('test-2')
    expect(cal?.calibrated).toBe(true)
    expect(cal?.deltaH).toBe(-30.0) // 500 - 530 = -30
  })

  it('场景2续：联网有 DEM 地形，起飞爬升 100m（海拔 600m）时，渲染高度为 630m', () => {
    const viewer = createMockViewer(530.0)
    const plane: PlaneState = {
      id: 'test-2',
      type: 'fp981c',
      lon: 109.5,
      lat: 18.2,
      alt: 500.0,
      heading: 90,
      groundSpeed: 0.0,
      verticalSpeed: 0.0,
      raw: {} as any,
    }
    aligner.getRenderHeight(plane, viewer)

    plane.alt = 600.0
    plane.groundSpeed = 40.0
    plane.verticalSpeed = 5.0

    const renderHeight = aligner.getRenderHeight(plane, viewer)
    expect(renderHeight).toBe(630.0) // 600 - (-30) = 630
  })

  it('防穿地保护：若飞控海拔异常低于地表高程，强制钳制在地表表面', () => {
    const viewer = createMockViewer(200.0)
    const plane: PlaneState = {
      id: 'test-3',
      type: 'fp95',
      lon: 110.0,
      lat: 20.0,
      alt: 100.0, // 初始地面 100m, 地表 200m -> deltaH = -100
      heading: 0,
      groundSpeed: 0.0,
      verticalSpeed: 0.0,
      raw: {} as any,
    }
    aligner.getRenderHeight(plane, viewer)

    // 假设飞到了一座 300m 的山头上方，但飞控海拔突然跌落
    const mountainViewer = createMockViewer(300.0)
    plane.alt = 150.0 // 算出的理论高 = 150 - (-100) = 250m < 300m 山头
    plane.groundSpeed = 25.0

    const renderHeight = aligner.getRenderHeight(plane, mountainViewer)
    expect(renderHeight).toBe(300.0) // 钳制在山顶表面，绝不钻地
  })

  it('isPlaneOnGround 判定逻辑有效性', () => {
    // 1. 静止状态
    expect(
      isPlaneOnGround({
        id: 'p1',
        type: 'uavInfo',
        lon: 0,
        lat: 0,
        alt: 100,
        heading: 0,
        groundSpeed: 0.5,
        verticalSpeed: 0.1,
        raw: {} as any,
      }),
    ).toBe(true)

    // 2. 高速巡航状态
    expect(
      isPlaneOnGround({
        id: 'p2',
        type: 'uavInfo',
        lon: 0,
        lat: 0,
        alt: 1000,
        heading: 0,
        groundSpeed: 35,
        verticalSpeed: 1.2,
        raw: {} as any,
      }),
    ).toBe(false)

    // 3. 带有相对高度（如 FP95）且大于 5m 时判定为在空
    expect(
      isPlaneOnGround({
        id: 'p3',
        type: 'fp95',
        lon: 0,
        lat: 0,
        alt: 1000,
        heading: 0,
        groundSpeed: 0.2,
        verticalSpeed: 0.0,
        raw: { relativeAltitude: 10.0 } as any,
      }),
    ).toBe(false)
  })

  it('reset 功能能够正确重置校准状态', () => {
    const viewer = createMockViewer(0)
    const plane: PlaneState = {
      id: 'test-reset',
      type: 'fp95',
      lon: 0,
      lat: 0,
      alt: 500,
      heading: 0,
      groundSpeed: 0,
      verticalSpeed: 0,
      raw: {} as any,
    }
    aligner.getRenderHeight(plane, viewer)
    expect(aligner.getCalibration('test-reset')).toBeDefined()

    aligner.reset('test-reset')
    expect(aligner.getCalibration('test-reset')).toBeUndefined()
  })
})
