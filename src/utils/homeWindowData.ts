export interface HomeWindowDataStore {
  loadCommsConfig: () => Promise<unknown>
  startPortsMonitoring: () => Promise<unknown>
  startListening: () => Promise<unknown>
}

export type UnlistenHomeWindowConfig = () => void
export type ListenForHomeWindowConfig = (
  handler: () => Promise<void>,
) => Promise<UnlistenHomeWindowConfig>

/** Mount the data listeners used by the main map window. */
export async function startHomeWindowDataListeners(
  store: HomeWindowDataStore,
): Promise<void> {
  await store.loadCommsConfig()
  await store.startPortsMonitoring()
  await store.startListening()
}

/** Keep the main map window in sync when another Tauri window saves comms config. */
export function subscribeHomeWindowConfigChanges(
  store: HomeWindowDataStore,
  listenForConfig: ListenForHomeWindowConfig,
): Promise<UnlistenHomeWindowConfig> {
  return listenForConfig(() => startHomeWindowDataListeners(store))
}
