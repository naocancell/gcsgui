import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/utils/homeWindowData'

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

export async function openOrRestoreTelemetryWindow() {
  if (!isTauri()) {
    window.open(
      telemetryWindowOptions.url,
      'telemetry',
      `width=${telemetryWindowOptions.width},height=${telemetryWindowOptions.height}`,
    )
    return
  }

  const existingWindow = await WebviewWindow.getByLabel('telemetry')
  if (existingWindow) {
    await existingWindow.unminimize()
    await existingWindow.show()
    await existingWindow.setFocus()
  } else {
    new WebviewWindow('telemetry', telemetryWindowOptions)
  }
}

export async function restoreTelemetryWindow(window: RestorableTelemetryWindow | null) {
  if (window) {
    await window.unminimize()
    await window.show()
    await window.setFocus()
  } else {
    await openOrRestoreTelemetryWindow()
  }
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
