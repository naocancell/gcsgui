export type ProtocolType = 'FP981C' | 'FP95' | 'UAVInfo' | 'ServoTurntable'
export type LinkKind = 'udp-unicast' | 'udp-multicast' | 'serial'

export interface LinkDraft {
  id: string
  name: string
  kind: LinkKind
  protocol: ProtocolType
  enabled: boolean
  autoConnect: boolean
  ip: string
  localPort: number
  targetPort: number
  interfaceIp: string
  portName: string
  baudRate: number
}

export interface PersistedUdpConfig {
  name: string
  mode?: 'unicast' | 'multicast'
  ip: string
  port: number
  target_port?: number
  interface_ip: string
  protocol: ProtocolType
  enabled: boolean
  auto_connect: boolean
}

export interface PersistedSerialConfig {
  name: string
  port_name: string
  baud_rate: number
  data_bits: number
  stop_bits: number
  parity: 'none' | 'odd' | 'even'
  protocol: ProtocolType
  enabled: boolean
  auto_connect: boolean
}

export interface PersistedCommsConfig {
  udp: PersistedUdpConfig[]
  serial: PersistedSerialConfig[]
}

let nextLinkId = 1

function makeId(prefix: string) {
  return `${prefix}-${nextLinkId++}`
}

export function createLinkDraft(
  kind: LinkKind = 'udp-multicast',
  index = nextLinkId,
): LinkDraft {
  const isSerial = kind === 'serial'
  return {
    id: makeId(`link-${index}`),
    name: isSerial ? `串口链路${index}` : `UDP链路${index}`,
    kind,
    protocol: isSerial ? 'FP981C' : 'FP981C',
    enabled: false,
    autoConnect: true,
    ip: kind === 'udp-multicast' ? '226.0.1.9' : '',
    localPort: 8999,
    targetPort: 8999,
    interfaceIp: '0.0.0.0',
    portName: '',
    baudRate: 115200,
  }
}

export function createDefaultLinkDrafts(): LinkDraft[] {
  return [
    {
      ...createLinkDraft('udp-multicast', 1),
      name: 'UAVInfo_UDP',
      protocol: 'UAVInfo',
      enabled: false,
      ip: '226.0.1.9',
      localPort: 8999,
      targetPort: 9001,
    },
    {
      ...createLinkDraft('udp-multicast', 2),
      name: 'FP95_UDP',
      protocol: 'FP95',
      enabled: false,
      ip: '226.0.1.9',
      localPort: 8999,
      targetPort: 8999,
    },
    {
      ...createLinkDraft('serial', 3),
      name: '主链路',
      enabled: false,
    },
    {
      ...createLinkDraft('serial', 4),
      name: '副链路',
      enabled: false,
    },
    {
      ...createLinkDraft('udp-unicast', 5),
      name: '伺服转台',
      protocol: 'ServoTurntable',
      enabled: false,
      autoConnect: true,
      ip: '192.168.1.100',
      localPort: 6001,
      targetPort: 6000,
      interfaceIp: '0.0.0.0',
    },
  ]
}

function protocolForLink(kind: LinkKind, protocol: ProtocolType): ProtocolType {
  return kind === 'serial' && (protocol === 'UAVInfo' || protocol === 'ServoTurntable') ? 'FP981C' : protocol
}
//整理Udp 串口配置中的数据 并返回
export function fromCommsConfig(config: PersistedCommsConfig): LinkDraft[] {
  const udpLinks = (config.udp ?? []).map((item, index) => {
    // udp模式判断 单播或组播
    const mode = item.mode === 'unicast' ? 'udp-unicast' : 'udp-multicast'
    return {
      id: makeId(`udp-${index}`),
      name: item.name,
      kind: mode as LinkKind,
      protocol: item.protocol,
      enabled: item.enabled,
      autoConnect: item.auto_connect,
      ip: item.ip,
      localPort: item.port,
      targetPort: item.target_port || item.port,
      interfaceIp: item.interface_ip,
      portName: '',
      baudRate: 115200,
    }
  })

  // 保证固定的“伺服转台”链路始终存在
  const hasServo = udpLinks.some((l) => l.protocol === 'ServoTurntable' || l.name === '伺服转台')
  if (!hasServo) {
    udpLinks.push({
      ...createLinkDraft('udp-unicast', 5),
      name: '伺服转台',
      protocol: 'ServoTurntable',
      enabled: false,
      autoConnect: true,
      ip: '192.168.1.100',
      localPort: 6001,
      targetPort: 6000,
      interfaceIp: '0.0.0.0',
    })
  }

  const serialLinks = (config.serial ?? []).map((item, index) => ({
    id: makeId(`serial-${index}`),
    name: item.name,
    kind: 'serial' as const,
    protocol: protocolForLink('serial', item.protocol),
    enabled: item.enabled,
    autoConnect: item.auto_connect,
    ip: '',
    localPort: 0,
    targetPort: 0,
    interfaceIp: '',
    portName: item.port_name, //com1
    baudRate: item.baud_rate,
  }))

  return [...udpLinks, ...serialLinks]
}

export function toCommsConfig(links: LinkDraft[]): PersistedCommsConfig {
  return {
    udp: links
      .filter((link) => link.kind !== 'serial')
      .map((link) => ({
        name: link.name.trim(),
        mode: link.kind === 'udp-unicast' ? 'unicast' : 'multicast',
        ip: link.ip.trim(),
        port: link.localPort,
        target_port: link.targetPort || link.localPort,
        interface_ip: link.interfaceIp.trim(),
        protocol: link.protocol,
        enabled: link.enabled,
        auto_connect: link.autoConnect,
      })),
    serial: links
      .filter((link) => link.kind === 'serial')
      .map((link) => ({
        name: link.name.trim(),
        port_name: link.portName.trim(),
        baud_rate: link.baudRate,
        data_bits: 8,
        stop_bits: 1,
        parity: 'none',
        protocol: protocolForLink('serial', link.protocol),
        enabled: link.enabled,
        auto_connect: link.autoConnect,
      })),
  }
}

function isValidIpv4(value: string) {
  const parts = value.split('.').map(Number)
  return (
    parts.length === 4
    && parts.every((part, index) => {
      const raw = value.split('.')[index]
      return raw !== '' && /^\d+$/.test(raw) && part >= 0 && part <= 255
    })
  )
}

function isMulticastIpv4(value: string) {
  if (!isValidIpv4(value)) return false
  const firstOctet = Number(value.split('.')[0])
  return firstOctet >= 224 && firstOctet <= 239
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

export function validateLinkDrafts(links: LinkDraft[]): string | null {
  const names = new Set<string>()
  const serialPorts = new Set<string>()
  const udpLocalPorts = new Set<number>()
  for (const link of links) {
    const name = link.name.trim()
    if (!name) return '链路名称不能为空'
    if (names.has(name)) return `链路名称不能重复: ${name}`
    names.add(name)

    if (!link.enabled) continue

    if (link.kind === 'serial') {
      if (!link.portName.trim()) return `请为链路“${name}”选择串口`
      const portName = link.portName.trim().toUpperCase()
      if (serialPorts.has(portName)) {
        return `链路“${name}”与其他串口链路使用了同一个串口: ${portName}`
      }
      serialPorts.add(portName)
      if (!Number.isInteger(link.baudRate) || link.baudRate <= 0) {
        return `链路“${name}”的波特率无效`
      }
      continue
    }

    if (!isValidIpv4(link.ip)) return `链路“${name}”的 UDP 地址无效`
    if (link.kind === 'udp-multicast' && !isMulticastIpv4(link.ip)) {
      return `链路“${name}”的组播地址无效`
    }
    if (link.kind === 'udp-unicast' && isMulticastIpv4(link.ip)) {
      return `链路“${name}”的点播地址不能使用组播地址`
    }
    if (!isValidPort(link.localPort)) return `链路“${name}”的本地端口无效`
    if (udpLocalPorts.has(link.localPort)) {
      return `链路“${name}”与其他 UDP 链路使用了同一个本地端口: ${link.localPort}`
    }
    udpLocalPorts.add(link.localPort)
    if (!isValidPort(link.targetPort)) return `链路“${name}”的目标端口无效`
    if (link.interfaceIp && !isValidIpv4(link.interfaceIp)) {
      return `链路“${name}”的网卡地址无效`
    }
  }
  return null
}
