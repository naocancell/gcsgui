import { describe, expect, it } from 'vitest'
import type { LinkHealthSnapshot } from '@/types/linkHealth'
import type { LinkDraft } from './commsConfig'
import { mergeConfiguredLinkHealth } from './linkHealth'

function makeLink(overrides: Partial<LinkDraft> = {}): LinkDraft {
  return {
    id: 'link-1',
    name: '链路一',
    kind: 'udp-multicast',
    protocol: 'FP981C',
    enabled: true,
    autoConnect: true,
    ip: '226.0.1.9',
    localPort: 8999,
    targetPort: 8999,
    interfaceIp: '0.0.0.0',
    portName: '',
    baudRate: 115200,
    ...overrides,
  }
}

function makeSnapshot(
  linkName: string,
  state: LinkHealthSnapshot['state'],
  uavId = 1,
): LinkHealthSnapshot {
  return {
    linkName,
    protocol: 'FP981C',
    uavId,
    state,
    validAgeMs: 10,
    freshAgeMs: 10,
    relativeDelayMs: 0,
    delayEwmaMs: 0,
    jitterEwmaMs: 0,
    deliveredFrames: 1,
    firstArrivalWins: 1,
    duplicateFrames: 0,
    staleFrames: 0,
    conflictFrames: 0,
    missedFrames: 0,
  }
}

describe('mergeConfiguredLinkHealth', () => {
  it('keeps configured order and shows disabled or no-data links', () => {
    const result = mergeConfiguredLinkHealth(
      [
        makeLink({ id: 'a', name: '链路A' }),
        makeLink({ id: 'b', name: '链路B', enabled: false }),
        makeLink({ id: 'c', name: '链路C' }),
      ],
      [makeSnapshot('链路A', 'healthy')],
    )

    expect(result.map((item) => [item.config.name, item.state])).toEqual([
      ['链路A', 'healthy'],
      ['链路B', 'disabled'],
      ['链路C', 'down'],
    ])
    expect(result[2].snapshots).toEqual([])
  })

  it('retains multiple aircraft snapshots and marks mixed health as suspect', () => {
    const result = mergeConfiguredLinkHealth(
      [makeLink({ name: '链路A' })],
      [
        makeSnapshot('链路A', 'healthy', 1),
        makeSnapshot('链路A', 'down', 2),
      ],
    )

    expect(result[0].snapshots).toHaveLength(2)
    expect(result[0].state).toBe('suspect')
  })

  it('does not attach a snapshot from the previous protocol after reconfiguration', () => {
    const result = mergeConfiguredLinkHealth(
      [makeLink({ name: '链路A', protocol: 'FP95' })],
      [makeSnapshot('链路A', 'healthy')],
    )

    expect(result[0].state).toBe('down')
    expect(result[0].snapshots).toEqual([])
  })
})
