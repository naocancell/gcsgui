/** 后端 `link-status-changed` 事件载荷（见 src-tauri/src/comms.rs LinkStatusEvent） */
export interface LinkStatusEvent {
  linkName: string
  linkType: 'SERIAL' | 'UDP' | string
  status: 'faulted' | 'recovered' | string
  reason?: string | null
}

export interface LinkStatusNotice {
  type: 'error' | 'success'
  content: string
}

export const LINK_STATUS_EVENT = 'link-status-changed'

/** 将链路状态事件转换为界面提示文案；未知状态返回 null 不提示 */
export function describeLinkStatus(
  event: LinkStatusEvent,
): LinkStatusNotice | null {
  const name = event.linkName || '未命名链路'
  if (event.status === 'faulted') {
    const reason = event.reason ? `（${event.reason}）` : ''
    const action =
      event.linkType === 'SERIAL'
        ? '，正在每 2 秒自动重连'
        : '，请在通信设置中重新启动该链路'
    return { type: 'error', content: `链路 ${name} 已断开${reason}${action}` }
  }
  if (event.status === 'recovered') {
    return { type: 'success', content: `链路 ${name} 已自动重连` }
  }
  return null
}
