import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauri } from '@/utils/homeWindowData'

export interface RestorableLinkHealthWindow {
  unminimize: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}

export interface HideableLinkHealthWindow {
  hide: () => Promise<void>
}

export interface PreventableCloseEvent {
  preventDefault: () => void
}

export const linkHealthWindowOptions = {
  url: 'index.html#/linkHealth',
  title: '链路状态信息 - LINK HEALTH',
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

export async function openOrRestoreLinkHealthWindow() {
  if (!isTauri()) {
    window.open(
      linkHealthWindowOptions.url,
      'linkHealth',
      `width=${linkHealthWindowOptions.width},height=${linkHealthWindowOptions.height}`,
    )
    return
  }

  const existingWindow = await WebviewWindow.getByLabel('linkHealth')
  if (existingWindow) {
    await existingWindow.unminimize()
    await existingWindow.show()
    await existingWindow.setFocus()
  } else {
    new WebviewWindow('linkHealth', linkHealthWindowOptions)
  }
}

export async function restoreLinkHealthWindow(window: RestorableLinkHealthWindow | null) {
  if (window) {
    await window.unminimize()
    await window.show()
    await window.setFocus()
  } else {
    await openOrRestoreLinkHealthWindow()
  }
}

export async function hideLinkHealthWindow(window: HideableLinkHealthWindow) {
  await window.hide()
}

export async function preserveLinkHealthWindowOnClose(
  event: PreventableCloseEvent,
  window: HideableLinkHealthWindow,
) {
  event.preventDefault()
  await hideLinkHealthWindow(window)
}
