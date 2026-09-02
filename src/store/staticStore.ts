import { defineStore } from 'pinia'
import type { Cartesian3 } from 'cesium'
import {
  DEFAULT_MENU_OPTIONS,
  type MenuOptionsConfig,
} from '@/constants/menuOptions'
import { MODEL_ASSETS, type ModelAssetMap } from '@/constants/models'
import { DEFAULT_WS_CONFIG, type WebsocketConfig } from '@/constants/websocket'

/** 临时认证信息 */
export interface TempAuthInfo {
  userName: string
  password: string
  token: string
}

/** 网络状态 */
export interface NetworkStatus {
  /** 是否处于离线模式 */
  offlineMode: boolean
}

/** WebSocket 连接状态 */
export interface WebsocketState {
  ws: WebSocket | null
  isOpen: boolean
  ws_config: WebsocketConfig
}

/** 无人机在地图中的实体状态 */
export interface UavState {
  /** 地图中的飞机 Entity ID */
  ModelIDinMap: string
}

/** 空间分析全局变量 */
export interface AnalysisVars {
  /** 当前空间分析类型：-1 未设置，1 地形剖面分析，2 视线通视分析 */
  analysisType: number
  /** 地形分析采样点数组 */
  profilePts: Cartesian3[]
}

/** 静态与全局配置状态定义 */
export interface StaticState {
  temp: TempAuthInfo
  networkStatus: NetworkStatus
  showRouteManage: boolean
  menuOptions: MenuOptionsConfig
  webskt: WebsocketState
  models: ModelAssetMap
  hasPlane: boolean
  uav: UavState
  analysisVars: AnalysisVars
}

export const useStaticStore = defineStore('staticOptions', {
  state: (): StaticState => ({
    temp: {
      userName: 'sysUser003',
      password: 'sysUser003',
      token: '',
    },
    networkStatus: {
      offlineMode: false,
    },
    showRouteManage: false,
    menuOptions: {
      obstacleOptions: [...DEFAULT_MENU_OPTIONS.obstacleOptions],
      EditOptions: [...DEFAULT_MENU_OPTIONS.EditOptions],
      sceneOptions: [...DEFAULT_MENU_OPTIONS.sceneOptions],
      MeasureOptions: [...DEFAULT_MENU_OPTIONS.MeasureOptions],
      DrawOptions: [...DEFAULT_MENU_OPTIONS.DrawOptions],
      AnalyzeOptions: [...DEFAULT_MENU_OPTIONS.AnalyzeOptions],
      layerOptions: [...DEFAULT_MENU_OPTIONS.layerOptions],
      LosAnalyzeOptions: [...DEFAULT_MENU_OPTIONS.LosAnalyzeOptions],
    },
    webskt: {
      ws: null,
      isOpen: false,
      ws_config: { ...DEFAULT_WS_CONFIG },
    },
    models: { ...MODEL_ASSETS },
    hasPlane: false,
    uav: {
      ModelIDinMap: '',
    },
    analysisVars: {
      analysisType: -1,
      profilePts: [],
    },
  }),
})

export default useStaticStore
