export interface HomeWindowDataStore {
  loadCommsConfig: () => Promise<unknown>
  startPortsMonitoring: () => Promise<unknown>
  startListening: () => Promise<unknown>
}

export type UnlistenHomeWindowConfig = () => void
export type ListenForHomeWindowConfig = (
  handler: () => Promise<void>,
) => Promise<UnlistenHomeWindowConfig>

/** 判断当前是否处于 Tauri 桌面端宿主环境中 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)
  )
}

/** Mount the data listeners used by the main map window. */
export async function startHomeWindowDataListeners(
  store: HomeWindowDataStore,
): Promise<void> {
  if (!isTauri()) {
    console.info(
      '[Browser Mode] 当前处于纯网页浏览器环境，已安全跳过 Tauri IPC 数据与串口监听服务',
    )
    return
  }
  await store.loadCommsConfig()
  await store.startPortsMonitoring()
  await store.startListening()
}

/** Keep the main map window in sync when another Tauri window saves comms config. */
export function subscribeHomeWindowConfigChanges(
  store: HomeWindowDataStore,
  listenForConfig: ListenForHomeWindowConfig,
): Promise<UnlistenHomeWindowConfig> {
  if (!isTauri()) {
    return Promise.resolve(() => {})
  }
  return listenForConfig(() => startHomeWindowDataListeners(store))
}
