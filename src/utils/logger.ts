import {
  trace as tauriTrace,
  debug as tauriDebug,
  info as tauriInfo,
  warn as tauriWarn,
  error as tauriError,
} from '@tauri-apps/plugin-log'

/**
 * 格式化任意参数为便于日志持久化的单行或结构化文本
 */
function formatArgs(msg: string, args: unknown[]): string {
  if (args.length === 0) return msg

  const formattedArgs = args.map((arg) => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}\nStack: ${arg.stack || '无栈信息'}`
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    }
    return String(arg)
  })

  return `${msg} ${formattedArgs.join(' ')}`
}

const isDev = import.meta.env.DEV

/**
 * 前端统一日志门面
 * - 开发环境：控制台输出
 * - 生产环境：通过 Tauri 日志插件与后端合流并落盘
 */
export const logger = {
  trace(message: string, ...args: unknown[]) {
    if (isDev) {
      console.debug(`%c[TRACE]%c ${message}`, 'color: #909399; font-weight: bold;', '', ...args)
    }
    const content = formatArgs(message, args)
    void tauriTrace(content).catch(() => {})
  },

  debug(message: string, ...args: unknown[]) {
    if (isDev) {
      console.debug(`%c[DEBUG]%c ${message}`, 'color: #409EFF; font-weight: bold;', '', ...args)
    }
    const content = formatArgs(message, args)
    void tauriDebug(content).catch(() => {})
  },

  info(message: string, ...args: unknown[]) {
    if (isDev) {
      console.info(`%c[INFO]%c ${message}`, 'color: #67C23A; font-weight: bold;', '', ...args)
    }
    const content = formatArgs(message, args)
    void tauriInfo(content).catch(() => {})
  },

  warn(message: string, ...args: unknown[]) {
    console.warn(`[WARN] ${message}`, ...args)
    const content = formatArgs(message, args)
    void tauriWarn(content).catch(() => {})
  },

  error(message: string, ...args: unknown[]) {
    console.error(`[ERROR] ${message}`, ...args)
    const content = formatArgs(message, args)
    void tauriError(content).catch(() => {})
  },
}

export default logger
