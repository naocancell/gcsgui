import type {
  MissionPayloadAggregate,
  VoltageSensorData,
} from '@/store/payloadStore'

/** 继电器回路分组（与大屏 4 个分区一一对应） */
export type RelayGroup = 'wing' | 'tail' | 'payload' | 'reserve'

export interface RelayChannelDef {
  id: number
  /** 协议图 3 原始名称 */
  name: string
  /** 大屏紧凑显示名称 */
  shortName: string
  group: RelayGroup
  /** 该回路对应的 6.3 电压采集字段（无采集点则为 null） */
  voltageKey: keyof VoltageSensorData | null
  /** 预留空回路：界面置灰且不可操作 */
  reserved?: boolean
}

/** 16 路回路真实物理名称（严格对应协议图 3 原始名称与通道号） */
export const RELAY_CHANNELS: RelayChannelDef[] = [
  {
    id: 1,
    name: '右平尾加热膜供电',
    shortName: '右平尾',
    group: 'tail',
    voltageKey: 'rightHorizontalTail',
  },
  {
    id: 2,
    name: '右垂尾加热膜供电',
    shortName: '右垂尾',
    group: 'tail',
    voltageKey: 'rightVerticalTail',
  },
  {
    id: 3,
    name: '右内机翼加热膜供电',
    shortName: '右内机翼',
    group: 'wing',
    voltageKey: 'rightInnerWing',
  },
  {
    id: 4,
    name: '右中机翼加热膜供电',
    shortName: '右中机翼',
    group: 'wing',
    voltageKey: 'rightMidWing',
  },
  {
    id: 5,
    name: '右外机翼加热膜供电',
    shortName: '右外机翼',
    group: 'wing',
    voltageKey: 'rightOuterWing',
  },
  {
    id: 6,
    name: '左垂尾加热膜供电',
    shortName: '左垂尾',
    group: 'tail',
    voltageKey: 'leftVerticalTail',
  },
  {
    id: 7,
    name: '左平尾加热膜供电',
    shortName: '左平尾',
    group: 'tail',
    voltageKey: 'leftHorizontalTail',
  },
  {
    id: 8,
    name: '机翼常加热膜供电',
    shortName: '机翼常加热',
    group: 'reserve',
    voltageKey: 'wingConstHeat',
  },
  {
    id: 9,
    name: '左内机翼加热膜供电',
    shortName: '左内机翼',
    group: 'wing',
    voltageKey: 'leftInnerWing',
  },
  {
    id: 10,
    name: '左中机翼加热膜供电',
    shortName: '左中机翼',
    group: 'wing',
    voltageKey: 'leftMidWing',
  },
  {
    id: 11,
    name: '左外机翼加热膜供电',
    shortName: '左外机翼',
    group: 'wing',
    voltageKey: 'leftOuterWing',
  },
  {
    id: 12,
    name: '大气测量-加温供电',
    shortName: '大气测量加温',
    group: 'payload',
    voltageKey: 'atmosphereHeat',
  },
  {
    id: 13,
    name: '云滴探测-加温供电',
    shortName: '云滴探测加温',
    group: 'payload',
    voltageKey: 'cloudDropHeat',
  },
  {
    id: 14,
    name: '电源设备供电',
    shortName: '电源设备',
    group: 'payload',
    voltageKey: null,
  },
  {
    id: 15,
    name: '桨叶防除冰控制',
    shortName: '桨叶防除冰',
    group: 'payload',
    voltageKey: null,
  },
  {
    id: 16,
    name: '空',
    shortName: '预留（空）',
    group: 'reserve',
    voltageKey: null,
    reserved: true,
  },
]

export interface RelayGroupDef {
  key: RelayGroup
  title: string
  columns: number
  channels: RelayChannelDef[]
}

function pick(ids: number[]): RelayChannelDef[] {
  return ids.map((id) => RELAY_CHANNELS[id - 1])
}

/** 大屏分区：机翼 6 路 / 尾翼 4 路 / 载荷 4 路 / 常加与预留 2 路 */
export const RELAY_GROUPS: RelayGroupDef[] = [
  {
    key: 'wing',
    title: '机翼加热膜供电回路（6 路 · 左右机翼独立控制）',
    columns: 3,
    channels: pick([11, 10, 9, 3, 4, 5]),
  },
  {
    key: 'tail',
    title: '尾翼加热膜供电回路（4 路 · 平尾与垂尾独立控制）',
    columns: 4,
    channels: pick([7, 1, 6, 2]),
  },
  {
    key: 'payload',
    title: '载荷温控与特种加热供电回路（4 路）',
    columns: 4,
    channels: pick([12, 13, 14, 15]),
  },
  {
    key: 'reserve',
    title: '常加热与预留回路（2 路）',
    columns: 2,
    channels: pick([8, 16]),
  },
]

/** 翼面加热分段：机体示意图、温压流矩阵共用 */
export type HeatSegmentKey =
  | 'leftOuter'
  | 'leftMid'
  | 'leftInner'
  | 'rightInner'
  | 'rightMid'
  | 'rightOuter'
  | 'leftHTail'
  | 'rightHTail'
  | 'leftVTail'
  | 'rightVTail'

export interface HeatSegment {
  key: HeatSegmentKey
  name: string
  tag: string
  relayId: number
  temp: number | null
  constTemp: number | null
  voltage: number | null
  current: number | null
}

function num(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null
}

/** 将载荷聚合遥测映射为 10 个加热分段（左=设备1，右=设备2） */
export function buildHeatSegments(
  p: MissionPayloadAggregate | null | undefined,
): HeatSegment[] {
  const t1 = p?.tempSensor1
  const t2 = p?.tempSensor2
  const v = p?.voltageSensor
  const c1 = p?.currentSensor1
  const c2 = p?.currentSensor2
  return [
    {
      key: 'leftOuter',
      name: '左翼外段',
      tag: '外机翼',
      relayId: 11,
      temp: num(t1?.outerWingHeat),
      constTemp: num(t1?.outerWingConst),
      voltage: num(v?.leftOuterWing),
      current: num(c1?.leftOuterWing),
    },
    {
      key: 'leftMid',
      name: '左翼中段',
      tag: '中机翼',
      relayId: 10,
      temp: num(t1?.midWingHeat),
      constTemp: num(t1?.midWingConst),
      voltage: num(v?.leftMidWing),
      current: num(c1?.leftMidWing),
    },
    {
      key: 'leftInner',
      name: '左翼内段',
      tag: '内机翼',
      relayId: 9,
      temp: num(t1?.innerWingHeat),
      constTemp: num(t1?.innerWingConst),
      voltage: num(v?.leftInnerWing),
      current: num(c1?.leftInnerWing),
    },
    {
      key: 'rightInner',
      name: '右翼内段',
      tag: '内机翼',
      relayId: 3,
      temp: num(t2?.innerWingHeat),
      constTemp: num(t2?.innerWingConst),
      voltage: num(v?.rightInnerWing),
      current: num(c2?.rightInnerWing),
    },
    {
      key: 'rightMid',
      name: '右翼中段',
      tag: '中机翼',
      relayId: 4,
      temp: num(t2?.midWingHeat),
      constTemp: num(t2?.midWingConst),
      voltage: num(v?.rightMidWing),
      current: num(c2?.rightMidWing),
    },
    {
      key: 'rightOuter',
      name: '右翼外段',
      tag: '外机翼',
      relayId: 5,
      temp: num(t2?.outerWingHeat),
      constTemp: num(t2?.outerWingConst),
      voltage: num(v?.rightOuterWing),
      current: num(c2?.rightOuterWing),
    },
    {
      key: 'leftHTail',
      name: '左平尾',
      tag: '水平尾翼',
      relayId: 7,
      temp: num(t1?.horizontalTail),
      constTemp: null,
      voltage: num(v?.leftHorizontalTail),
      current: num(c1?.leftHorizontalTail),
    },
    {
      key: 'rightHTail',
      name: '右平尾',
      tag: '水平尾翼',
      relayId: 1,
      temp: num(t2?.horizontalTail),
      constTemp: null,
      voltage: num(v?.rightHorizontalTail),
      current: num(c2?.rightHorizontalTail),
    },
    {
      key: 'leftVTail',
      name: '左垂尾',
      tag: '垂直尾翼',
      relayId: 6,
      temp: num(t1?.verticalTail),
      constTemp: null,
      voltage: num(v?.leftVerticalTail),
      current: num(c1?.leftVerticalTail),
    },
    {
      key: 'rightVTail',
      name: '右垂尾',
      tag: '垂直尾翼',
      relayId: 2,
      temp: num(t2?.verticalTail),
      constTemp: null,
      voltage: num(v?.rightVerticalTail),
      current: num(c2?.rightVerticalTail),
    },
  ]
}

/** 6.3 电压采集模块 11 路系统供电通道（协议原始顺序） */
export const SYSTEM_VOLTAGE_CHANNELS: {
  key: keyof VoltageSensorData
  name: string
}[] = [
  { key: 'v100Input', name: '100V输入电压' },
  { key: 'batteryInput', name: '电池输入电压' },
  { key: 'v48BoostModule', name: '48V升压模块 · 电压采集' },
  { key: 'stepDownModule', name: '降压模块 · 电压采集' },
  { key: 'rectifier1Input', name: '整流器1输入电压' },
  { key: 'rectifier1PostRelay', name: '整流器1后继电器电压' },
  { key: 'rectifier3', name: '整流器3 · 电压采集' },
  { key: 'regulator1Output', name: '稳压模块1输出电压' },
  { key: 'regulator2Output', name: '稳压模块2输出电压' },
  { key: 'atmosphereHeat', name: '大气测量 · 加温供电电压' },
  { key: 'cloudDropHeat', name: '云滴探测 · 加温电压' },
]

/** 电压条满量程 (V) */
export const VOLTAGE_BAR_FULL_SCALE = 150

export function voltageBarPercent(val: number | null | undefined): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) return 0
  return Math.min(100, (val / VOLTAGE_BAR_FULL_SCALE) * 100)
}

/** 电压等级仅用于配色区分电源层级（高压/中压/低压），不代表告警 */
export function voltageTier(
  val: number | null | undefined,
): 'high' | 'mid' | 'low' {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 'low'
  if (val >= 60) return 'high'
  if (val >= 20) return 'mid'
  return 'low'
}

/** Magnus 公式计算露点温度 (℃) */
export function dewPoint(
  tempC: number | null | undefined,
  rh: number | null | undefined,
): number | null {
  if (
    typeof tempC !== 'number' ||
    !Number.isFinite(tempC) ||
    typeof rh !== 'number' ||
    !Number.isFinite(rh) ||
    rh <= 0
  ) {
    return null
  }
  const a = 17.62
  const b = 243.12
  const gamma = Math.log(Math.min(rh, 100) / 100) + (a * tempC) / (b + tempC)
  return (b * gamma) / (a - gamma)
}

/** 实际功率相对目标功率偏差百分比 */
export function powerDeviationPercent(
  target: number | null | undefined,
  current: number | null | undefined,
): number | null {
  if (
    typeof target !== 'number' ||
    !Number.isFinite(target) ||
    target <= 0 ||
    typeof current !== 'number' ||
    !Number.isFinite(current)
  ) {
    return null
  }
  return ((current - target) / target) * 100
}

/** 将功率历史样本转为 SVG 折线坐标 */
export function buildSparklinePoints(
  values: (number | null)[],
  width: number,
  height: number,
  min: number,
  max: number,
  padding = 4,
): string {
  if (values.length === 0 || !(max > min)) return ''
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const pts: string[] = []
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return
    const ratio = (v - min) / (max - min)
    const y = height - padding - ratio * (height - padding * 2)
    pts.push(`${(i * step).toFixed(1)},${y.toFixed(1)}`)
  })
  return pts.join(' ')
}

export function fmtFixed(val: unknown, digits = 1): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val.toFixed(digits)
  }
  return '—'
}
