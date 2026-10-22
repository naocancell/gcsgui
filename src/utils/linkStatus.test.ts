import { describe, expect, it } from 'vitest'
import { describeLinkStatus } from './linkStatus'

describe('describeLinkStatus', () => {
  it('串口断开提示自动重连并带上原因', () => {
    expect(
      describeLinkStatus({
        linkName: '主链路串口',
        linkType: 'SERIAL',
        status: 'faulted',
        reason: '设备已拔出',
      }),
    ).toEqual({
      type: 'error',
      content: '链路 主链路串口 已断开（设备已拔出），正在每 2 秒自动重连',
    })
  })

  it('UDP 断开提示手动重启', () => {
    const notice = describeLinkStatus({
      linkName: 'FP95 UDP',
      linkType: 'UDP',
      status: 'faulted',
      reason: null,
    })
    expect(notice?.type).toBe('error')
    expect(notice?.content).toBe(
      '链路 FP95 UDP 已断开，请在通信设置中重新启动该链路',
    )
  })

  it('恢复时给出成功提示，未知状态不提示', () => {
    expect(
      describeLinkStatus({
        linkName: '副链路串口',
        linkType: 'SERIAL',
        status: 'recovered',
      }),
    ).toEqual({ type: 'success', content: '链路 副链路串口 已自动重连' })
    expect(
      describeLinkStatus({ linkName: 'x', linkType: 'UDP', status: 'running' }),
    ).toBeNull()
  })
})
