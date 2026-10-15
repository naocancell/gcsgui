import { describe, it, expect } from 'vitest'
import {
  RELAY_CHANNELS,
  RELAY_GROUPS,
  buildHeatSegments,
  buildSparklinePoints,
  dewPoint,
  powerDeviationPercent,
  voltageBarPercent,
  voltageTier,
} from './dashboardModel'

describe('防除冰大屏数据映射', () => {
  it('16 路继电器通道号连续且与协议名称一致', () => {
    expect(RELAY_CHANNELS).toHaveLength(16)
    RELAY_CHANNELS.forEach((ch, i) => expect(ch.id).toBe(i + 1))
    expect(RELAY_CHANNELS[0].name).toBe('右平尾加热膜供电')
    expect(RELAY_CHANNELS[7].name).toBe('机翼常加热膜供电')
    expect(RELAY_CHANNELS[15].reserved).toBe(true)
  })

  it('大屏 4 个分区完整覆盖 16 路且不重复', () => {
    const ids = RELAY_GROUPS.flatMap((g) => g.channels.map((c) => c.id))
    expect(ids).toHaveLength(16)
    expect(new Set(ids).size).toBe(16)
    expect(RELAY_GROUPS.map((g) => g.channels.length)).toEqual([6, 4, 4, 2])
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

  it('露点、功率偏差、电压条等派生量计算正确且对非法值防御', () => {
    expect(dewPoint(-12.4, 62)!).toBeCloseTo(-18.2, 1)
    expect(dewPoint(null, 50)).toBeNull()
    expect(dewPoint(10, 0)).toBeNull()
    expect(powerDeviationPercent(2000, 1986)!).toBeCloseTo(-0.7, 5)
    expect(powerDeviationPercent(0, 100)).toBeNull()
    expect(voltageBarPercent(75)).toBe(50)
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
})
