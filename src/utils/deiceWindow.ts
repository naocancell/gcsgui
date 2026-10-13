import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/utils/homeWindowData'

export interface RestorableDeiceWindow {
  unminimize: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export interface HideableDeiceWindow {
  hide: () => Promise<void>
}

export interface PreventableCloseEvent {
  preventDefault: () => void
}

export const deiceWindowOptions = {
  url: 'index.html#/deice',
  title: '防除冰系统监控 - DEICE MONITOR',
  width: 1600,
  height: 920,
  minWidth: 1280,
  minHeight: 760,
  resizable: true,
  maximizable: true,
  decorations: false,
  center: true,
  focus: true,
}

export async function openOrRestoreDeiceWindow() {
  if (!isTauri()) {
    window.open(
      deiceWindowOptions.url,
      'deice',
      `width=${deiceWindowOptions.width},height=${deiceWindowOptions.height}`,
    )
    return
  }

  const existingWindow = await WebviewWindow.getByLabel('deice')
  if (existingWindow) {
    await existingWindow.unminimize()
    await existingWindow.show()
    await existingWindow.setFocus()
  } else {
    new WebviewWindow('deice', deiceWindowOptions)
  }
}

export async function restoreDeiceWindow(window: RestorableDeiceWindow | null) {
  if (window) {
    await window.unminimize()
    await window.show()
    await window.setFocus()
  } else {
    await openOrRestoreDeiceWindow()
  }
}

export async function hideDeiceWindow(window: HideableDeiceWindow) {
  await window.hide()
}

export async function preserveDeiceWindowOnClose(
  event: PreventableCloseEvent,
  window: HideableDeiceWindow,
) {
  event.preventDefault()
  await hideDeiceWindow(window)
}
