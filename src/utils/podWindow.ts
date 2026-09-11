import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/utils/homeWindowData'

export interface RestorablePodWindow {
  unminimize: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export interface HideablePodWindow {
  hide: () => Promise<void>
}

export interface PreventableCloseEvent {
  preventDefault: () => void
}

export const podWindowOptions = {
  url: 'index.html#/pod',
  title: '光电吊舱控制 - POD CONTROL',
  width: 800,
  height: 900,
  minWidth: 800,
  minHeight: 640,
  resizable: true,
  maximizable: false,
  decorations: false,
  center: true,
  focus: true,
}

export async function openOrRestorePodWindow() {
  if (!isTauri()) {
    window.open(
      podWindowOptions.url,
      'pod',
      `width=${podWindowOptions.width},height=${podWindowOptions.height}`,
    )
    return
  }

  const existingWindow = await WebviewWindow.getByLabel('pod')
  if (existingWindow) {
    await existingWindow.unminimize()
    await existingWindow.show()
    await existingWindow.setFocus()
  } else {
    new WebviewWindow('pod', podWindowOptions)
  }
}

export async function restorePodWindow(window: RestorablePodWindow | null) {
  if (window) {
    await window.unminimize()
    await window.show()
    await window.setFocus()
  } else {
    await openOrRestorePodWindow()
  }
}

export async function hidePodWindow(window: HideablePodWindow) {
  await window.hide()
}

export async function preservePodWindowOnClose(
  event: PreventableCloseEvent,
  window: HideablePodWindow,
) {
  event.preventDefault()
  await hidePodWindow(window)
}
