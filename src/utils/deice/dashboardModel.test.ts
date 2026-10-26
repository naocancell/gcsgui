import { describe, it, expect } from 'vitest'
import {
  CONTROLLABLE_RELAY_COUNT,
  RELAY_CHANNELS,
  RELAY_GROUPS,
  buildHeatSegments,
  buildConstHeatRow,
  buildHeatStripRows,
  buildSparklinePoints,
  normalizeConstPowerTarget,
  normalizeConstTempTarget,
  powerDeviationPercent,
  voltageBarPercent,
  voltageTier,
} from './dashboardModel'

describe('防除冰大屏数据映射', () => {
  it('15 路有效继电器通道号连续且与协议名称一致', () => {
    expect(RELAY_CHANNELS).toHaveLength(15)
    RELAY_CHANNELS.forEach((ch, i) => expect(ch.id).toBe(i + 1))
    expect(RELAY_CHANNELS[0].name).toBe('右平尾加热膜供电')
    expect(RELAY_CHANNELS[7].name).toBe('机翼常加热膜供电')
    expect(RELAY_CHANNELS[14].name).toBe('桨叶防除冰控制')
    // 新协议读线圈数量 0x0F：可控 15 路
    expect(CONTROLLABLE_RELAY_COUNT).toBe(15)
  })

  it('大屏 4 个分区完整覆盖 15 路且不重复', () => {
    const ids = RELAY_GROUPS.flatMap((g) => g.channels.map((c) => c.id))
    expect(ids).toHaveLength(15)
    expect(new Set(ids).size).toBe(15)
    expect(RELAY_GROUPS.map((g) => g.channels.length)).toEqual([6, 4, 4, 1])
  })

  it('加热分段按左=设备1、右=设备2映射温度/电压/电流与继电器', () => {
    const segs = buildHeatSegments({
      uavId: 95,
      relay: null,
      boostModule: null,
      tempSensor1: {
        innerWingConst: 1,
        midWingConst: 2,
        outerWingConst: 3,
        innerWingHeat: -1.5,
        midWingHeat: -1.8,
        outerWingHeat: -2.1,
        batteryA: 0,
        batteryB: 0,
        verticalTail: -1.1,
        horizontalTail: -0.8,
      },
      tempSensor2: null,
      voltageSensor: { leftOuterWing: 241 } as never,
      currentSensor1: { leftOuterWing: 4.2 } as never,
      currentSensor2: null,
      environmentSensor: null,
      icingSensor: null,
      lastUpdatedMs: 0,
    })
    expect(segs).toHaveLength(10)
    const lo = segs.find((s) => s.key === 'leftOuter')!
    expect(lo).toMatchObject({
      relayId: 11,
      temp: -2.1,
      constTemp: 3,
      voltage: 241,
      current: 4.2,
    })
    const ri = segs.find((s) => s.key === 'rightInner')!
    expect(ri).toMatchObject({ relayId: 3, temp: null, voltage: null })
    expect(segs.find((s) => s.key === 'leftVTail')!.relayId).toBe(6)
    expect(segs.find((s) => s.key === 'rightHTail')!.relayId).toBe(1)
  })

  it('无遥测时分段数值全部为 null，不出现假 0', () => {
    for (const s of buildHeatSegments(null)) {
      expect(s.temp).toBeNull()
      expect(s.voltage).toBeNull()
      expect(s.current).toBeNull()
    }
  })

  it('功率偏差、电压条等派生量计算正确且对非法值防御', () => {
    expect(powerDeviationPercent(2000, 1986)!).toBeCloseTo(-0.7, 5)
    expect(powerDeviationPercent(0, 100)).toBeNull()
    expect(voltageBarPercent(50)).toBe(50)
    expect(voltageBarPercent(75)).toBe(75)
    expect(voltageBarPercent(1000)).toBe(100)
    expect(voltageBarPercent(Number.NaN)).toBe(0)
    expect(voltageTier(99.8)).toBe('high')
    expect(voltageTier(24.5)).toBe('mid')
    expect(voltageTier(12)).toBe('low')
  })

  it('折线坐标跳过缺失样本', () => {
    const pts = buildSparklinePoints([0, null, 10], 100, 50, 0, 10, 0)
    expect(pts).toBe('0.0,50.0 100.0,0.0')
    expect(buildSparklinePoints([], 100, 50, 0, 10)).toBe('')
  })

  it('9 条加热条：左右垂尾合并为垂直尾翼并取均值', () => {
    const segs = buildHeatSegments(null).map((s) =>
      s.key === 'leftVTail'
        ? { ...s, temp: -1.0, voltage: 120, current: 1.0 }
        : s.key === 'rightVTail'
          ? { ...s, temp: -2.0, voltage: 122, current: 1.4 }
          : s,
    )
    const rows = buildHeatStripRows(segs)
    expect(rows.map((r) => r.name)).toEqual([
      '左翼外段',
      '左翼中段',
      '左翼内段',
      '右翼外段',
      '右翼中段',
      '右翼内段',
      '左平尾',
      '右平尾',
      '垂直尾翼',
    ])
    const v = rows[8]
    expect(v.relayIds).toEqual([6, 2])
    expect(v.temp).toBeCloseTo(-1.5, 5)
    expect(v.voltage).toBeCloseTo(121, 5)
    expect(v.current).toBeCloseTo(1.2, 5)
    expect(rows[0].temp).toBeNull()
  })

  it('机翼常加热行（CH08）：温度取 6 路最低值，电压/电流取常加热专用通道', () => {
    const constTemps = (inner: number, mid: number, outer: number) =>
      ({
        innerWingConst: inner,
        midWingConst: mid,
        outerWingConst: outer,
      }) as never
    const row = buildConstHeatRow({
      tempSensor1: constTemps(1.2, -0.4, 0.8),
      tempSensor2: constTemps(0.5, 2.1, -1.3),
      voltageSensor: { wingConstHeat: 118.6 },
      currentSensor1: { wingConstHeat: 6.25 },
    } as never)
    expect(row).toMatchObject({
      key: 'wingConst',
      name: '机翼常加热',
      relayIds: [8],
      temp: -1.3,
      voltage: 118.6,
      current: 6.25,
    })
    expect(row.detail).toContain('右外 -1.3°C')

    const empty = buildConstHeatRow(null)
    expect(empty.temp).toBeNull()
    expect(empty.voltage).toBeNull()
    expect(empty.current).toBeNull()
  })

  it('恒功率目标功率：仅允许 0~2000W，越界与非法值不下发', () => {
    expect(normalizeConstPowerTarget(2000)).toBe(2000)
    expect(normalizeConstPowerTarget(0)).toBe(0)
    expect(normalizeConstPowerTarget(1499.6)).toBe(1500)
    expect(normalizeConstPowerTarget(2001)).toBeNull()
    expect(normalizeConstPowerTarget(-1)).toBeNull()
    expect(normalizeConstPowerTarget(Number.NaN)).toBeNull()
    expect(normalizeConstPowerTarget('2000')).toBeNull()
  })

  it('恒温目标温度：仅允许 0~100℃，负温与非法值不下发', () => {
    expect(normalizeConstTempTarget(15)).toBe(15)
    expect(normalizeConstTempTarget(0)).toBe(0)
    expect(normalizeConstTempTarget(100)).toBe(100)
    expect(normalizeConstTempTarget(14.6)).toBe(15)
    expect(normalizeConstTempTarget(-10)).toBeNull()
    expect(normalizeConstTempTarget(-0.6)).toBeNull()
    expect(normalizeConstTempTarget(101)).toBeNull()
    expect(normalizeConstTempTarget(Number.NaN)).toBeNull()
    expect(normalizeConstTempTarget('20')).toBeNull()
  })
})
