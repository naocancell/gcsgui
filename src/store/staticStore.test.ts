import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStaticStore } from './staticStore'
import useStaticStoreDefault, { useStaticStore as useStaticStoreNamed } from './staticOptions'
import {
  DEFAULT_MENU_OPTIONS,
  OBSTACLE_OPTIONS,
  EDIT_OPTIONS,
  SCENE_OPTIONS,
  MEASURE_OPTIONS,
  DRAW_OPTIONS,
  ANALYZE_OPTIONS,
  INITIAL_LAYER_OPTIONS,
  LOS_ANALYZE_OPTIONS,
  MODEL_ASSETS,
  DEFAULT_WS_CONFIG,
} from '@/constants'

describe('staticStore & constants verification', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exports valid constants matching the specification', () => {
    expect(OBSTACLE_OPTIONS).toHaveLength(2)
    expect(EDIT_OPTIONS).toHaveLength(3)
    expect(SCENE_OPTIONS).toHaveLength(2)
    expect(MEASURE_OPTIONS).toHaveLength(3)
    expect(DRAW_OPTIONS).toHaveLength(4)
    expect(ANALYZE_OPTIONS).toHaveLength(2)
    expect(INITIAL_LAYER_OPTIONS).toHaveLength(1)
    expect(LOS_ANALYZE_OPTIONS).toHaveLength(2)

    expect(DEFAULT_WS_CONFIG.address).toBe('127.0.0.1')
    expect(DEFAULT_WS_CONFIG.port).toBe(9090)

    expect(MODEL_ASSETS.defaultAirPlane).toBeDefined()
    expect(MODEL_ASSETS.fp985).toBeDefined()
    expect(MODEL_ASSETS.fp98).toBeDefined()

    expect(DEFAULT_MENU_OPTIONS.obstacleOptions).toEqual([...OBSTACLE_OPTIONS])
    expect(DEFAULT_MENU_OPTIONS.EditOptions).toEqual([...EDIT_OPTIONS])
  })

  it('initializes useStaticStore with expected state shape and default values', () => {
    const store = useStaticStore()

    // temp auth
    expect(store.temp.userName).toBe('sysUser003')
    expect(store.temp.password).toBe('sysUser003')
    expect(store.temp.token).toBe('')

    // networkStatus
    expect(store.networkStatus.offlineMode).toBe(false)

    // showRouteManage
    expect(store.showRouteManage).toBe(false)

    // menuOptions
    expect(store.menuOptions.obstacleOptions).toEqual([...OBSTACLE_OPTIONS])
    expect(store.menuOptions.EditOptions).toEqual([...EDIT_OPTIONS])
    expect(store.menuOptions.sceneOptions).toEqual([...SCENE_OPTIONS])
    expect(store.menuOptions.MeasureOptions).toEqual([...MEASURE_OPTIONS])
    expect(store.menuOptions.DrawOptions).toEqual([...DRAW_OPTIONS])
    expect(store.menuOptions.AnalyzeOptions).toEqual([...ANALYZE_OPTIONS])
    expect(store.menuOptions.layerOptions).toEqual([...INITIAL_LAYER_OPTIONS])
    expect(store.menuOptions.LosAnalyzeOptions).toEqual([...LOS_ANALYZE_OPTIONS])

    // webskt
    expect(store.webskt.ws).toBeNull()
    expect(store.webskt.isOpen).toBe(false)
    expect(store.webskt.ws_config.address).toBe('127.0.0.1')
    expect(store.webskt.ws_config.port).toBe(9090)

    // models & plane
    expect(store.models.defaultAirPlane).toBeDefined()
    expect(store.models.fp985).toBeDefined()
    expect(store.models.fp98).toBeDefined()
    expect(store.hasPlane).toBe(false)
    expect(store.uav.ModelIDinMap).toBe('')

    // analysisVars
    expect(store.analysisVars.analysisType).toBe(-1)
    expect(store.analysisVars.profilePts).toEqual([])
  })

  it('provides full backward compatibility through staticOptions.ts re-export', () => {
    const storeFromDefault = useStaticStoreDefault()
    const storeFromNamed = useStaticStoreNamed()
    const storeDirect = useStaticStore()

    expect(storeFromDefault).toBe(storeDirect)
    expect(storeFromNamed).toBe(storeDirect)
  })

  it('allows state mutation reactively as expected by components', () => {
    const store = useStaticStore()

    store.networkStatus.offlineMode = true
    expect(store.networkStatus.offlineMode).toBe(true)

    store.showRouteManage = true
    expect(store.showRouteManage).toBe(true)

    store.analysisVars.analysisType = 2
    expect(store.analysisVars.analysisType).toBe(2)

    store.uav.ModelIDinMap = 'ID: FP-98_01'
    expect(store.uav.ModelIDinMap).toBe('ID: FP-98_01')
  })
})
