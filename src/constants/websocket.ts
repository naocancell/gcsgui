/**
 * 默认 WebSocket 通信配置
 */
export interface WebsocketConfig {
  address: string
  port: number
}

/** 默认 WebSocket 服务端地址及端口 */
export const DEFAULT_WS_CONFIG: Readonly<WebsocketConfig> = {
  address: '127.0.0.1',
  port: 9090,
} as const
