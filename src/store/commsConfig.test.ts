import { describe, expect, it } from 'vitest'
import {
  FIXED_LINK_NAMES,
  createDefaultLinkDrafts,
  fromCommsConfig,
  isFixedLink,
  toCommsConfig,
  validateLinkDrafts,
  type PersistedUdpConfig,
} from './commsConfig'

function udp(
  name: string,
  protocol: PersistedUdpConfig['protocol'],
  port: number,
): PersistedUdpConfig {
  return {
    name,
    mode: 'unicast',
    ip: '127.0.0.1',
    port,
    target_port: port,
    interface_ip: '0.0.0.0',
    protocol,
    enabled: false,
    auto_connect: false,
  }
}

describe('固定链路', () => {
  it('默认配置包含四条固定链路且使用新名称', () => {
    const fixed = createDefaultLinkDrafts().filter(isFixedLink)
    expect(fixed.map((link) => link.name)).toEqual([
      '伺服转台转发',
      '大气数据测量转发',
      '焰条转发',
      '云滴探测分析系统转发',
    ])
  })

  it('旧配置按协议识别：改为固定名称、去掉重复、补齐缺失', () => {
    const links = fromCommsConfig({
      udp: [
        udp('FP95_UDP', 'FP95', 8999),
        udp('伺服转台', 'ServoTurntable', 6001),
        udp('人影大气测量透传(0xC0)', 'PassthroughC0', 9100),
        udp('手动加的透传', 'PassthroughC0', 9200),
      ],
      serial: [],
    })

    expect(links.map((link) => link.name)).toEqual([
      'FP95_UDP',
      '伺服转台转发',
      '大气数据测量转发',
      '焰条转发',
      '云滴探测分析系统转发',
    ])
    // 保留旧配置的参数，重复条目丢弃
    expect(links[1].localPort).toBe(6001)
    expect(links[2].localPort).toBe(9100)
    expect(validateLinkDrafts(links)).toBeNull()
  })

  it('保存时固定链路名称不受编辑影响', () => {
    const links = createDefaultLinkDrafts()
    const servo = links.find((link) => link.protocol === 'ServoTurntable')!
    servo.name = '被改掉的名字'

    const config = toCommsConfig(links)
    expect(
      config.udp.find((item) => item.protocol === 'ServoTurntable')?.name,
    ).toBe(FIXED_LINK_NAMES.ServoTurntable)
  })

  it('同一固定协议出现两条时拒绝保存', () => {
    const links = createDefaultLinkDrafts()
    const extra = { ...links[0], id: 'dup', protocol: 'PassthroughC1' as const }
    expect(validateLinkDrafts([...links, extra])).toContain('焰条转发')
  })
})
