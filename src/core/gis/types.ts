import { Airline, AirlinePoint } from '@/types/entityoptions'

/**
 * 重新导出实体和航线相关类型，供 GIS 核心模块与外部使用
 */
export * from '@/types/entityoptions'

/**
 * 创建并初始化一个空航点对象
 * @returns 默认初始化的航点数据对象
 */
export function newAirlinePt(): AirlinePoint {
  const pt: AirlinePoint = {
    alt: undefined as unknown as number,
    ch1: 0,
    ch2: 0,
    lat: undefined as unknown as number,
    lon: undefined as unknown as number,
    nPt: undefined as unknown as number,
    speed: 0,
  }
  return pt
}

/**
 * 创建并初始化一个空航线对象
 * @returns 默认初始化的航线数据对象
 */
export function newAirline(): Airline {
  const flyLine: Airline = {
    PtNum: undefined as unknown as number,
    code: undefined as unknown as number,
    isClose: false,
    isVisible: true,
    name: '',
    points: [],
    totalDistance: undefined as unknown as number,
    unicode: '',
  }
  return flyLine
}
