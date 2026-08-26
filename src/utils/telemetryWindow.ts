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
  //窗口打开并展示哪个页面
  url: 'index.html#/telemetry', //入口文件+hash+Vue路由路径
  title: '无人机航电系统 - UAV AVIONICS',
  width: 820,
  height: 820,
  minWidth: 820,
  minHeight: 820,
  resizable: false,
  maximizable: false,
  decorations: false,//系统窗口自带的标题栏
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
