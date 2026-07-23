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

export async function restoreLinkHealthWindow(window: RestorableLinkHealthWindow) {
  await window.unminimize()
  await window.show()
  await window.setFocus()
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
