import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as GIS from './index'
import {
  newAirline,
  newAirlinePt,
  dataProcess_fromQT,
  dataProcess_fromQT_route,
  getUavTypeStr,
  setChartOptions,
  query_surface_forecast,
  query_upper_forecast,
  requireWeatherLevel,
  NFZViewer,
  MeasureViewer,
  RouteManageViewer,
} from './index'
import { useLayerStore } from '@/store/layerManagerStore'

// Mock axios and tauri
vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({ data: { success: true } }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}))

describe('GIS Domain Engine Modules Verification', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exports all GIS classes, types, and functions from index.ts', () => {
    expect(GIS.NFZViewer).toBeDefined()
    expect(GIS.MeasureViewer).toBeDefined()
    expect(GIS.RouteManageViewer).toBeDefined()
    expect(GIS.newAirline).toBeDefined()
    expect(GIS.newAirlinePt).toBeDefined()
    expect(GIS.dataProcess_fromQT).toBeDefined()
    expect(GIS.dataProcess_fromQT_route).toBeDefined()
    expect(GIS.getUavTypeStr).toBeDefined()
    expect(GIS.setChartOptions).toBeDefined()
    expect(GIS.query_surface_forecast).toBeDefined()
    expect(GIS.query_upper_forecast).toBeDefined()
    expect(GIS.requireWeatherLevel).toBeDefined()
  })

  it('verifies airline factory functions in types.ts', () => {
    const pt = newAirlinePt()
    expect(pt.ch1).toBe(0)
    expect(pt.ch2).toBe(0)
    expect(pt.speed).toBe(0)
    expect(pt.lon).toBeUndefined()
    expect(pt.lat).toBeUndefined()
    expect(pt.alt).toBeUndefined()

    const airline = newAirline()
    expect(airline.name).toBe('')
    expect(airline.isClose).toBe(false)
    expect(airline.isVisible).toBe(true)
    expect(airline.points).toEqual([])
  })

  it('verifies websocket protocol parser logic', () => {
    const layerStore = useLayerStore()
    layerStore.navi.hFactor = 5

    const qtPosData = {
      pos: {
        uavId: 'UAV_981_01',
        uavType: '981A',
        HeadAngle: 45,
        FyAngle: 2.5,
        lon: 116.397,
        lat: 39.908,
        height: 120,
        groundSpeed: 60,
      },
      navi: {
        currentRouteID: 101,
        nextRouteID: 102,
        nextPoint: 3,
        distonext: 1500,
      },
    }

    const dynamicInfo = dataProcess_fromQT(qtPosData)
    expect(dynamicInfo).not.toBeNull()
    expect(dynamicInfo?.uavId).toBe('UAV_981_01')
    expect(dynamicInfo?.heading).toBe(45)
    expect(dynamicInfo?.pitch).toBe(2.5)
    expect(dynamicInfo?.lon).toBe(116.397)
    expect(dynamicInfo?.lat).toBe(39.908)
    expect(dynamicInfo?.alt).toBe(125) // 120 + hFactor(5)
    expect(dynamicInfo?.groundSpeed).toBe(60)

    expect(layerStore.navi.currentRouteID).toBe(101)
    expect(layerStore.navi.nextRouteID).toBe(102)
    expect(layerStore.navi.nextPoint).toBe(3)
    expect(layerStore.navi.distonext).toBe(1500)

    expect(getUavTypeStr(1)).toBe('981A')
    expect(getUavTypeStr(2)).toBe('981C')
    expect(getUavTypeStr(99)).toBe('test')
  })

  it('verifies websocket route parsing logic', () => {
    const qtRouteData = {
      route: {
        isClose: 1,
        points: [
          { lon: 116.1, lat: 39.1, height: 100, ch1: 0, ch2: 0, nPt: 1, nV: 50, nL: 201 },
          { lon: 116.2, lat: 39.2, height: 200, ch1: 0, ch2: 0, nPt: 2, nV: 55, nL: 201 },
        ],
      },
    }

    const route = dataProcess_fromQT_route(qtRouteData)
    expect(route).not.toBeNull()
    expect(route?.PtNum).toBe(2)
    expect(route?.isClose).toBe(true)
    expect(route?.code).toBe(201)
    expect(route?.name).toBe('lineID-201')
    expect(route?.points).toHaveLength(2)
    expect(route?.points[0].lon).toBe(116.1)
    expect(route?.points[1].alt).toBe(200)
  })

  it('verifies weather API functions return promises', () => {
    const surfacePromise = query_surface_forecast(116.39, 39.9)
    const upperPromise = query_upper_forecast(116.39, 39.9, 850)
    const levelPromise = requireWeatherLevel()

    expect(surfacePromise).toBeInstanceOf(Promise)
    expect(upperPromise).toBeInstanceOf(Promise)
    expect(levelPromise).toBeInstanceOf(Promise)
  })

  it('verifies weather chart options configuration', () => {
    const mockChart: any = {
      setOption: vi.fn(),
    }

    setChartOptions(
      mockChart,
      ['00:00', '03:00', '06:00'],
      [20, 22, 25],
      [5, 6, 8],
      [45, 135, 270],
      [0, 1.2, 0.5],
    )

    expect(mockChart.setOption).toHaveBeenCalledTimes(1)
    const options = mockChart.setOption.mock.calls[0][0]
    expect(options.backgroundColor).toBe('#101014')
    expect(options.xAxis).toHaveLength(2)
    expect(options.yAxis).toHaveLength(3)
    expect(options.series).toHaveLength(3)
  })

  it('verifies NFZViewer, MeasureViewer, and RouteManageViewer class methods and lifecycle', () => {
    // 验证类构造与销毁接口定义
    expect(typeof NFZViewer.prototype.init).toBe('function')
    expect(typeof NFZViewer.prototype.clear).toBe('function')
    expect(typeof NFZViewer.prototype.destroy).toBe('function')
    expect(typeof NFZViewer.prototype.toggleNFZ).toBe('function')

    expect(typeof MeasureViewer.prototype.destroy).toBe('function')
    expect(typeof MeasureViewer.prototype.activate).toBe('function')
    expect(typeof MeasureViewer.prototype.deactivate).toBe('function')
    expect(typeof MeasureViewer.prototype.clearDisEntity).toBe('function')
    expect(typeof MeasureViewer.prototype.activateAreaMeasure).toBe('function')
    expect(typeof MeasureViewer.prototype.clearAreaEntity).toBe('function')

    expect(typeof RouteManageViewer.prototype.destroy).toBe('function')
    expect(typeof RouteManageViewer.prototype.clearAllRoutes).toBe('function')
    expect(typeof RouteManageViewer.prototype.addAirLine).toBe('function')
    expect(typeof RouteManageViewer.prototype.removeRoute).toBe('function')
    expect(typeof RouteManageViewer.prototype.startEditRoute).toBe('function')
    expect(typeof RouteManageViewer.prototype.saveEditRoute).toBe('function')
    expect(typeof RouteManageViewer.prototype.cancelEditRoute).toBe('function')
    expect(typeof RouteManageViewer.prototype.flyToRoute).toBe('function')
  })
})
