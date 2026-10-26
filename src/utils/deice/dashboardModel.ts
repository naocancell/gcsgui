import type {
  MissionPayloadAggregate,
  VoltageSensorData,
} from '@/store/payloadStore'

/** 继电器回路分组（与大屏 4 个分区一一对应） */
export type RelayGroup = 'wing' | 'tail' | 'payload' | 'reserve'

export interface RelayChannelDef {
  id: number
  /** 协议表 4（继电器控制模块控制位置）原始名称 */
  name: string
  /** 大屏紧凑显示名称 */
  shortName: string
  /** 回路控制卡片显示名称（设计稿样式，不含通道号） */
  tileName: string
  group: RelayGroup
  /** 该回路对应的表 3 电压采集字段（无采集点则为 null） */
  voltageKey: keyof VoltageSensorData | null
}

/** 15 路有效回路真实物理名称（严格对应协议表 4 原始名称与 IO 口编号，第 16 路为空） */
export const RELAY_CHANNELS: RelayChannelDef[] = [
  {
    id: 1,
    name: '右平尾加热膜供电',
    shortName: '右平尾',
    tileName: '右平尾加热膜',
    group: 'tail',
    voltageKey: 'rightHorizontalTail',
  },
  {
    id: 2,
    name: '右垂尾加热膜供电',
    shortName: '右垂尾',
    tileName: '右垂尾加热膜',
    group: 'tail',
    voltageKey: 'rightVerticalTail',
  },
  {
    id: 3,
    name: '右内机翼加热膜供电',
    shortName: '右内机翼',
    tileName: '右内机翼加热膜',
    group: 'wing',
    voltageKey: 'rightInnerWing',
  },
  {
    id: 4,
    name: '右中机翼加热膜供电',
    shortName: '右中机翼',
    tileName: '右中机翼加热膜',
    group: 'wing',
    voltageKey: 'rightMidWing',
  },
  {
    id: 5,
    name: '右外机翼加热膜供电',
    shortName: '右外机翼',
    tileName: '右外机翼加热膜',
    group: 'wing',
    voltageKey: 'rightOuterWing',
  },
  {
    id: 6,
    name: '左垂尾加热膜供电',
    shortName: '左垂尾',
    tileName: '左垂尾加热膜',
    group: 'tail',
    voltageKey: 'leftVerticalTail',
  },
  {
    id: 7,
    name: '左平尾加热膜供电',
    shortName: '左平尾',
    tileName: '左平尾加热膜',
    group: 'tail',
    voltageKey: 'leftHorizontalTail',
  },
  {
    id: 8,
    name: '机翼常加热膜供电',
    shortName: '机翼常加热',
    tileName: '机翼常加热膜',
    group: 'reserve',
    voltageKey: 'wingConstHeat',
  },
  {
    id: 9,
    name: '左内机翼加热膜供电',
    shortName: '左内机翼',
    tileName: '左内机翼加热膜',
    group: 'wing',
    voltageKey: 'leftInnerWing',
  },
  {
    id: 10,
    name: '左中机翼加热膜供电',
    shortName: '左中机翼',
    tileName: '左中机翼加热膜',
    group: 'wing',
    voltageKey: 'leftMidWing',
  },
  {
    id: 11,
    name: '左外机翼加热膜供电',
    shortName: '左外机翼',
    tileName: '左外机翼加热膜',
    group: 'wing',
    voltageKey: 'leftOuterWing',
  },
  {
    id: 12,
    name: '大气测量-加温供电',
    shortName: '大气测量加温',
    tileName: '大气测量加温',
    group: 'payload',
    voltageKey: 'atmosphereHeat',
  },
  {
    id: 13,
    name: '云滴探测-加温供电',
    shortName: '云滴探测加温',
    tileName: '云滴探测加温',
    group: 'payload',
    voltageKey: 'cloudDropHeat',
  },
  {
    id: 14,
    name: '电源设备供电',
    shortName: '电源设备',
    tileName: '电源设备供电',
    group: 'payload',
    voltageKey: null,
  },
  {
    id: 15,
    name: '桨叶防除冰控制',
    shortName: '桨叶防除冰',
    tileName: '桨叶防除冰控制',
    group: 'payload',
    voltageKey: null,
  },
]

/** 可控回路数：新协议读线圈数量为 15（第 16 路为空） */
export const CONTROLLABLE_RELAY_COUNT = RELAY_CHANNELS.length

export interface RelayGroupDef {
  key: RelayGroup
  title: string
  columns: number
  channels: RelayChannelDef[]
}

function pick(ids: number[]): RelayChannelDef[] {
  return ids.map((id) => RELAY_CHANNELS[id - 1])
}

/** 大屏分区（设计稿顺序）：机翼 6 路 / 尾翼 4 路 / 载荷 4 路 / 常加热 1 路 */
export const RELAY_GROUPS: RelayGroupDef[] = [
  {
    key: 'wing',
    title: '机翼加热膜供电回路',
    columns: 3,
    channels: pick([5, 4, 3, 9, 10, 11]),
  },
  {
    key: 'tail',
    title: '翼面加热膜供电回路',
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
    title: '常加热供电回路',
    columns: 1,
    channels: pick([8]),
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

/** 表 3 电压采集模块 11 路系统供电通道（协议原始顺序） */
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

/** 电压条满量程 (V，协议 1.2.3.1 量程为 100V) */
export const VOLTAGE_BAR_FULL_SCALE = 100

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

/** 温压流矩阵 / 机体图共用的 9 条加热条（左右垂尾合并为“垂直尾翼”） */
export interface HeatStripRow {
  key: string
  name: string
  relayIds: number[]
  temp: number | null
  voltage: number | null
  current: number | null
  /** 悬停明细（合并行列出各分段原始值） */
  detail: string
}

function avg(list: (number | null)[]): number | null {
  const vals = list.filter((v): v is number => v !== null)
  if (!vals.length) return null
  return vals.reduce((sum, v) => sum + v, 0) / vals.length
}

const STRIP_ORDER: { key: string; name: string; parts: HeatSegmentKey[] }[] = [
  { key: 'leftOuter', name: '左翼外段', parts: ['leftOuter'] },
  { key: 'leftMid', name: '左翼中段', parts: ['leftMid'] },
  { key: 'leftInner', name: '左翼内段', parts: ['leftInner'] },
  { key: 'rightOuter', name: '右翼外段', parts: ['rightOuter'] },
  { key: 'rightMid', name: '右翼中段', parts: ['rightMid'] },
  { key: 'rightInner', name: '右翼内段', parts: ['rightInner'] },
  { key: 'leftHTail', name: '左平尾', parts: ['leftHTail'] },
  { key: 'rightHTail', name: '右平尾', parts: ['rightHTail'] },
  { key: 'vTail', name: '垂直尾翼', parts: ['leftVTail', 'rightVTail'] },
]

export function buildHeatStripRows(segments: HeatSegment[]): HeatStripRow[] {
  return STRIP_ORDER.map((row) => {
    const parts = row.parts
      .map((k) => segments.find((s) => s.key === k))
      .filter((s): s is HeatSegment => Boolean(s))
    const detail = parts
      .map(
        (s) =>
          `${s.name} CH${String(s.relayId).padStart(2, '0')}：${fmtFixed(s.temp, 1)}°C / ${fmtFixed(s.voltage, 1)}V / ${fmtFixed(s.current, 2)}A`,
      )
      .join('\n')
    return {
      key: row.key,
      name: row.name,
      relayIds: parts.map((s) => s.relayId),
      temp: avg(parts.map((s) => s.temp)),
      voltage: avg(parts.map((s) => s.voltage)),
      current: avg(parts.map((s) => s.current)),
      detail,
    }
  })
}

/** 机翼常加热膜（CH08）6 路采温：左=设备1、右=设备2 */
const CONST_TEMP_POINTS: {
  name: string
  sensor: 'tempSensor1' | 'tempSensor2'
  field: 'innerWingConst' | 'midWingConst' | 'outerWingConst'
}[] = [
  { name: '左内', sensor: 'tempSensor1', field: 'innerWingConst' },
  { name: '左中', sensor: 'tempSensor1', field: 'midWingConst' },
  { name: '左外', sensor: 'tempSensor1', field: 'outerWingConst' },
  { name: '右内', sensor: 'tempSensor2', field: 'innerWingConst' },
  { name: '右中', sensor: 'tempSensor2', field: 'midWingConst' },
  { name: '右外', sensor: 'tempSensor2', field: 'outerWingConst' },
]

/**
 * 温压流矩阵“机翼常加热”行（CH08）：
 * 温度取 6 路常加热膜采温最低值，电压/电流取常加热膜专用采集通道。
 */
export function buildConstHeatRow(
  p: MissionPayloadAggregate | null | undefined,
): HeatStripRow {
  const temps = CONST_TEMP_POINTS.map((pt) => ({
    name: pt.name,
    temp: num(p?.[pt.sensor]?.[pt.field]),
  }))
  const valid = temps.map((t) => t.temp).filter((t): t is number => t !== null)
  const voltage = num(p?.voltageSensor?.wingConstHeat)
  const current = num(p?.currentSensor1?.wingConstHeat)
  const detail = [
    `机翼常加热膜 CH08：${fmtFixed(voltage, 1)}V / ${fmtFixed(current, 2)}A`,
    `温度（取最低）：${temps.map((t) => `${t.name} ${fmtFixed(t.temp, 1)}°C`).join(' / ')}`,
  ].join('\n')
  return {
    key: 'wingConst',
    name: '机翼常加热',
    relayIds: [8],
    temp: valid.length ? Math.min(...valid) : null,
    voltage,
    current,
    detail,
  }
}

/** 恒温模式目标温度允许范围（℃，协议参数为 uint16，不支持负温） */
export const CONST_TEMP_TARGET_MIN = 0
export const CONST_TEMP_TARGET_MAX = 100

/** 恒功率模式目标功率允许范围（W，DFB-2000 额定 2000W，与后端上限一致） */
export const CONST_POWER_TARGET_MIN = 0
export const CONST_POWER_TARGET_MAX = 2000

/** 校验恒功率目标功率：取整后需落在允许范围内，否则返回 null（不下发，不静默截断） */
export function normalizeConstPowerTarget(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null
  const p = Math.round(val)
  if (p < CONST_POWER_TARGET_MIN || p > CONST_POWER_TARGET_MAX) return null
  return p
}

/** 校验恒温目标温度：取整后需落在允许范围内，否则返回 null（不下发） */
export function normalizeConstTempTarget(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null
  const t = Math.round(val)
  if (t < CONST_TEMP_TARGET_MIN || t > CONST_TEMP_TARGET_MAX) return null
  return t
}
