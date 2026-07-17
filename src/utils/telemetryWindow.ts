export interface RestorableTelemetryWindow {
  unminimize: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export interface HideableTelemetryWindow {
  hide: () => Promise<void>
}

export interface PreventableCloseEvent {
  preventDefault: () => void
}

export const telemetryWindowOptions = {
  url: 'index.html#/telemetry',
  title: '无人机航电系统 - UAV AVIONICS',
  width: 820,
  height: 820,
  minWidth: 820,
  minHeight: 820,
  resizable: false,
  maximizable: false,
  decorations: false,
  center: true,
  focus: true,
}

export async function restoreTelemetryWindow(window: RestorableTelemetryWindow) {
  await window.unminimize()
  await window.show()
  await window.setFocus()
}

export async function hideTelemetryWindow(window: HideableTelemetryWindow) {
  await window.hide()
}

export async function preserveTelemetryWindowOnClose(
  event: PreventableCloseEvent,
  window: HideableTelemetryWindow,
) {
  event.preventDefault()
  await hideTelemetryWindow(window)
}

export async function exitApplicationOnClose(
  event: PreventableCloseEvent,
  exitApplication: () => Promise<unknown>,
) {
  event.preventDefault()
  await exitApplication()
}
